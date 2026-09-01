// Server-side flyer extraction with Google Gemini. Ported from
// repos/SandboxDemos/flyer-ocr-extractor/server/extract.js — the API key stays
// on this server and never reaches the app.

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs', 'gemini-usage.jsonl');
const MAX_RETRIES = 3;

// How many requests to keep in flight at once.
const REQUEST_CONCURRENCY = 3;

// Flyer pages per Gemini request. 1 is the most reliable (full recall, tight
// bounding boxes). 2-3 is a safe compromise for fewer calls. Above ~3 the model
// starts silently dropping products and boxes drift. Clamped to [1, 4].
const PAGES_PER_REQUEST = clampInt(process.env.PAGES_PER_REQUEST, 1, 1, 4);

function clampInt(value, fallback, lo, hi) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

const PROMPT_HEADER = `You are given one or more pages of a single retail / grocery flyer. Each image is
one page and is preceded by a line like "=== PAGE 3 ===" giving its page number.

Extract EVERY distinct product across ALL pages shown into one JSON array — be
exhaustive, do not skip items even on a crowded page, do not stop early.`;

const PROMPT_FIELDS = `For each product:
- "page": the page number (from the "=== PAGE N ===" label) the product appears on.
- "name": the product name exactly as printed (brand + product line, e.g.
  "Great Value bacon", "Silk Almond, Cashew or Protein soy beverage"). Copy the
  printed text; do not summarise or turn it into a category.
- "priceValue": the price as a NUMBER in dollars. Flyers print the cents as a
  small superscript next to a large dollar figure — you MUST place the decimal
  point: a big "29" with a superscript "97" is 29.97, NOT 2997. "$13" + "96" is
  13.96. "34¢" is 0.34. "$3.17/lb" is 3.17. If there is no price, use 0.
- "price": the same price formatted as text, with the decimal and any unit —
  "$29.97", "$13.96", "34¢", "$3.17/lb", "$1.97 each". Never write it as a run of
  digits with no separator.
- "info": size / quantity / pack / promo detail near the product ("375 g",
  "6 x 591 mL", "Selected varieties"). Empty string if none.
- "box": the product tile's bounding box [ymin, xmin, ymax, xmax], each 0-1000,
  normalised to THAT product's page image. Include the photo and the text block.

Return [] if there are no products.`;

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      page: { type: 'INTEGER' },
      name: { type: 'STRING' },
      priceValue: { type: 'NUMBER' },
      price: { type: 'STRING' },
      info: { type: 'STRING' },
      box: { type: 'ARRAY', items: { type: 'NUMBER' } },
    },
    required: ['page', 'name', 'priceValue', 'price', 'info', 'box'],
  },
};

// Fix a mangled price string ("2997" -> "$29.97"). priceValue is a number, so it
// can't lose its decimal — trust it whenever the string looks suspect.
function reconcilePrice(price, priceValue) {
  const raw = (price ?? '').trim();
  const value =
    typeof priceValue === 'number' && isFinite(priceValue) && priceValue > 0 ? priceValue : null;

  if (/[¢₵]/.test(raw) || /\bfor\b|\//.test(raw)) return raw;
  if (/\d[.,]\d{2}\b/.test(raw)) return raw.startsWith('$') ? raw : `$${raw}`;

  if (/^\$?\s?\d{3,}$/.test(raw)) {
    if (value) return `$${value.toFixed(2)}`;
    const digits = raw.replace(/\D/g, '');
    return `$${digits.slice(0, -2)}.${digits.slice(-2)}`;
  }

  if (value) return `$${value.toFixed(2)}`;
  if (/^\d{1,2}$/.test(raw)) return `$${raw}`;
  return raw;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (x) => x.toLocaleString('en-US');

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function config() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error(
      'GEMINI_API_KEY is not set. Copy server/.env.example to server/.env and add a free key from https://aistudio.google.com/apikey',
    );
  }
  return { apiKey, model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite' };
}

async function callGemini(payload, apiKey, model) {
  const url = `${API_BASE}/${model}:generateContent`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json();

    const body = await res.text();
    const retryable = res.status === 429 || res.status === 503;
    if (retryable && attempt < MAX_RETRIES) {
      const m = body.match(/"retryDelay":\s*"(\d+)s"/);
      await sleep((m ? parseInt(m[1], 10) : 8) * 1000 + 1000);
      continue;
    }
    const badKey =
      res.status === 401 ||
      res.status === 403 ||
      (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(body));
    if (badKey) {
      throw new Error(
        `Gemini rejected the API key (${res.status}). GEMINI_API_KEY in server/.env must be a Google AI Studio key — it starts with "AIza" (or "AQ."). Create a free one at https://aistudio.google.com/apikey.`,
      );
    }
    throw new Error(`Gemini API error (${res.status}): ${body.slice(0, 500)}`);
  }
}

function readUsage(json) {
  const u = json.usageMetadata ?? {};
  const modality = (name) =>
    (u.promptTokensDetails ?? []).find((d) => d.modality === name)?.tokenCount ?? 0;
  return {
    promptTokens: u.promptTokenCount ?? 0,
    promptTextTokens: modality('TEXT'),
    promptImageTokens: modality('IMAGE'),
    outputTokens: u.candidatesTokenCount ?? 0,
    thoughtsTokens: u.thoughtsTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
  };
}

// batch: [{ page, jpeg }]
async function extractBatch(batch, apiKey, model) {
  const pageNums = batch.map((p) => p.page);
  const parts = [{ text: PROMPT_HEADER }];
  for (const p of batch) {
    parts.push({ text: `=== PAGE ${p.page} ===` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: p.jpeg } });
  }
  parts.push({ text: PROMPT_FIELDS });

  const json = await callGemini(
    {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: Math.min(65536, 5000 * batch.length + 6000),
      },
    },
    apiKey,
    model,
  );

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error(
        `Gemini response for pages ${pageNums.join(', ')} was cut off by the output limit — lower PAGES_PER_REQUEST or raise maxOutputTokens in server/src/gemini.js`,
      );
    }
    throw new Error(`Unexpected Gemini response: ${JSON.stringify(json).slice(0, 500)}`);
  }

  const items = JSON.parse(text);
  const fallbackPage = pageNums[0];
  const products = items.map((p) => {
    let page = parseInt(p.page, 10);
    if (!pageNums.includes(page)) page = fallbackPage;
    const priceValue = typeof p.priceValue === 'number' ? p.priceValue : Number(p.priceValue);
    return {
      page,
      name: (p.name || '').toString().trim(),
      price: reconcilePrice((p.price || '').toString().trim(), priceValue),
      priceValue: isFinite(priceValue) && priceValue > 0 ? priceValue : null,
      info: (p.info || '').toString().trim(),
      box: Array.isArray(p.box) && p.box.length === 4 ? p.box.map(Number) : null,
    };
  });

  return { products, usage: readUsage(json) };
}

async function appendUsageLog(entry) {
  try {
    await mkdir(dirname(LOG_FILE), { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.warn('[gemini] could not write usage log:', err.message);
  }
}

/**
 * @param {Array<{ page: number, jpeg: string }>} pages  page number + base64 JPEG (no data: prefix)
 * @returns {Promise<{ products: Array<object>, usage: object }>}
 */
export async function extractFlyer(pages) {
  // Offline smoke-test path (GEMINI_API_KEY=MOCK) — exercises render -> POST ->
  // crop -> grid without a live key.
  if (process.env.GEMINI_API_KEY === 'MOCK') {
    const products = pages.flatMap((p) =>
      [
        { name: 'Mock Product A', price: '$3.99', priceValue: 3.99, info: 'each' },
        { name: 'Mock Product B', price: '$1.49', priceValue: 1.49, info: '500 g' },
        { name: 'Mock Product C', price: '$8.97', priceValue: 8.97, info: 'Selected varieties' },
      ].map((m, j) => ({
        id: `${p.page}-${j}`,
        page: p.page,
        ...m,
        box: [j * 300 + 40, 40, j * 300 + 280, 470],
      })),
    );
    return { products, usage: { calls: 0, mock: true } };
  }

  const { apiKey, model } = config();
  const batches = chunk(pages, PAGES_PER_REQUEST);

  const results = new Array(batches.length);
  const requests = new Array(batches.length);
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= batches.length) return;
      const batch = batches[i];
      const label = batch.map((p) => p.page).join(',');
      const started = Date.now();
      const { products, usage } = await extractBatch(batch, apiKey, model);
      const ms = Date.now() - started;

      requests[i] = { pages: batch.map((p) => p.page), products: products.length, ms, ...usage };
      results[i] = products;

      console.log(
        `[gemini] pages ${label}  ` +
          `prompt=${n(usage.promptTokens)} (text ${n(usage.promptTextTokens)}, image ${n(usage.promptImageTokens)})  ` +
          `output=${n(usage.outputTokens)}  thoughts=${n(usage.thoughtsTokens)}  ` +
          `total=${n(usage.totalTokens)}  ${products.length} products  ${(ms / 1000).toFixed(1)}s`,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(REQUEST_CONCURRENCY, batches.length) }, worker),
  );

  const flat = results.flat().map((p, i) => ({ id: `${p.page}-${i}`, ...p }));

  const total = requests.reduce(
    (a, u) => ({
      calls: a.calls + 1,
      promptTokens: a.promptTokens + u.promptTokens,
      promptImageTokens: a.promptImageTokens + u.promptImageTokens,
      outputTokens: a.outputTokens + u.outputTokens,
      thoughtsTokens: a.thoughtsTokens + u.thoughtsTokens,
      totalTokens: a.totalTokens + u.totalTokens,
    }),
    {
      calls: 0,
      promptTokens: 0,
      promptImageTokens: 0,
      outputTokens: 0,
      thoughtsTokens: 0,
      totalTokens: 0,
    },
  );

  console.log(
    `[gemini] TOTAL  ${total.calls} call(s)  ${PAGES_PER_REQUEST} page(s)/call  model=${model}  ` +
      `prompt=${n(total.promptTokens)} (image ${n(total.promptImageTokens)})  ` +
      `output=${n(total.outputTokens)}  thoughts=${n(total.thoughtsTokens)}  total=${n(total.totalTokens)}`,
  );

  await appendUsageLog({
    at: new Date().toISOString(),
    model,
    pagesPerRequest: PAGES_PER_REQUEST,
    pages: pages.length,
    products: flat.length,
    requests,
    total,
  });

  return {
    products: flat,
    usage: { model, pagesPerRequest: PAGES_PER_REQUEST, perRequest: requests, total },
  };
}
