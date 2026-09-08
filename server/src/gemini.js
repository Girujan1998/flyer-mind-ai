// Server-side flyer extraction with Google Gemini. Ported from
// repos/SandboxDemos/flyer-ocr-extractor/server/extract.js — the API key stays
// on this server and never reaches the app.

import {appendFile, mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {DEPARTMENTS, cleanDepartment} from './departments.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const LOG_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'logs',
  'gemini-usage.jsonl',
);
const MAX_RETRIES = 3;

// How many requests to keep in flight at once.
const REQUEST_CONCURRENCY = 3;

// Flyer pages per Gemini request. 1 is the most reliable (full recall, tight
// bounding boxes). 2-3 is a safe compromise for fewer calls. Above ~3 the model
// starts silently dropping products and boxes drift. Clamped to [1, 4].
const PAGES_PER_REQUEST = clampInt(process.env.PAGES_PER_REQUEST, 1, 1, 4);

function clampInt(value, fallback, lo, hi) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) {
    return fallback;
  }
  return Math.max(lo, Math.min(hi, n));
}

const PROMPT_HEADER = `You are given one or more pages of a single retail / grocery flyer. Each image is
one page and is preceded by a line like "=== PAGE 3 ===" giving its page number.

Extract EVERY distinct product across ALL pages shown into one JSON array — be
exhaustive, do not skip items even on a crowded page, do not stop early.`;

const PROMPT_FIELDS = `Flyer tiles sit close together. Read every field for a product ONLY from text
that is physically inside that product's own tile — never borrow the name,
price, size or SKU from a neighbouring tile. If a field is not clearly inside
this tile, leave it empty / 0 rather than guessing.

For each product:
- "page": the page number (from the "=== PAGE N ===" label) the product appears on.
- "name": the product name exactly as printed (brand + product line, e.g.
  "Great Value bacon", "Silk Almond, Cashew or Protein soy beverage"). Copy the
  printed text; do not summarise or turn it into a category.
- "priceValue": the price as a NUMBER in dollars. Look carefully at each digit
  (a bold "3" and "7" are easy to confuse in flyer fonts). Flyers print the
  cents as a small superscript next to a large dollar figure — the LARGE digits
  are whole dollars, the small raised digits immediately after are the two-digit
  cents: a big "29" with a superscript "97" is 29.97, NOT 2997. "$13" + "96" is
  13.96. "34¢" is 0.34. "$3.17/lb" is 3.17. If there is no price, use 0. If the
  tile shows a struck-through "was" price and a current price, use the current one.
  If a price sits between two tiles and you cannot tell which product it belongs
  to, use 0 and an empty "price" string, and lower "confidence" — do not guess.
- "price": the same price formatted as text, with the decimal and any unit —
  "$29.97", "$13.96", "34¢", "$3.17/lb", "$1.97 each". Never write it as a run of
  digits with no separator.
- "info": size / quantity / pack detail printed INSIDE this tile ("375 g",
  "6 x 591 mL", "Selected varieties"). Empty string if none is inside this tile.
- "wasPrice": ONLY if the tile shows a struck-through / "reg." / "was" regular
  price next to the current one, put that OLD price here as text ("$5.99").
  Empty string when there is no crossed-out price — most flyer tiles have none.
- "promoText": the tile's explicit deal callout, copied short and verbatim —
  "Save $2", "Save 30%", "2 for $5", "Buy 1 Get 1", "Rollback", "Clearance",
  "Members price", "Spend $25 get 2000 points". Empty string if the tile just
  shows a plain price with no discount wording.
- "box": this product tile's bounding box [ymin, xmin, ymax, xmax], each 0-1000,
  normalised to THAT product's page image. It must tightly enclose ONLY this one
  product — its photo and its own text block — and not spill into the tiles
  beside it.
- "confidence": integer 0-100, how sure you are that name, price and box are all
  correct for THIS product. Lower it when digits are ambiguous, the tile is small
  or crowded, or text could belong to a neighbour.
- "category": the product's generic type in 1-4 lowercase words — no brand, no
  size, no packaging words — the term a shopper would type to find it. Prefer the
  everyday word over the label's marketing one: "ice milk" -> "ice cream",
  "soy beverage" -> "plant-based milk", "Athena Club full body dry spray
  deodorant" -> "body spray deodorant", "Lactantia lactose free cream" ->
  "cream". English even on a bilingual flyer.
- "tags": 2-6 lowercase extra search terms a shopper might use for this product —
  synonyms, the bare noun, the aisle word, a broader and a narrower term, e.g.
  ["deodorant", "body spray", "antiperspirant"]. No brand names, no sizes, and
  do not simply repeat "category".
- "department": exactly ONE store aisle from this list, lowercase, copied
  verbatim: ${DEPARTMENTS.join(', ')}. Pick the aisle a shopper physically walks
  to. Fresh whole fruit -> "fruit"; fresh whole vegetables -> "vegetables";
  anything frozen -> "frozen"; milk/cheese/yogurt/butter/eggs (incl. chocolate
  milk) -> "dairy & eggs"; soda/juice/water/coffee -> "beverages";
  chips/candy/cookies -> "snacks & candy"; laundry detergent/fabric softener/
  stain remover -> "laundry"; dish soap/cleaners/trash bags -> "household &
  cleaning"; paper towels/toilet paper/napkins -> "paper goods";
  shampoo/deodorant/makeup -> "beauty & personal care"; vitamins/medicine/first
  aid -> "health & wellness". Use "other" only when nothing else fits.

One price shared by two products: if a single price clearly covers TWO OR MORE
distinct products in the same tile (different product lines — e.g. "Tylenol Extra
Strength" bottles next to a "Precise Pain Relief Cream" — not just size/flavour
variants or front/back shots of one item), output a SEPARATE row for EACH
product: same "price" and "priceValue" on every row, but each row with its own
"name", its own "info", and its own tight "box" around just that one product's
photo and label. If instead it is ONE product line shown as several package shots
(two sizes at one price, front/back, "selected varieties"), that is ONE row with
one box enclosing all its shots.

Return [] if there are no products.`;

// --- Flyer-level metadata (store + validity window) --------------------------
// A separate, cheap call against page 1 only. Kept out of the per-product schema
// so the products array stays clean and this can't truncate it.

function metaPrompt(year) {
  return `This is page 1 of a retail store flyer / weekly circular. Read only what is
printed on this page and return ONE JSON object (not an array):

- "store": the retailer name from the largest logo or masthead — the banner only
  ("Walmart", "Food Basics", "No Frills", "Loblaws", "Costco"). No slogan, no
  street address, no "Supercentre"/"Weekly Flyer" suffix. "" if no name is visible.
- "validFrom": the FIRST day the flyer's prices are in effect, as "YYYY-MM-DD".
  Flyers print this as "Prices in effect Thursday, August 28", "Valid Aug 28 –
  Sep 3", "Sale dates 08/28–09/03", "Semaine du 28 août". Take the START of the
  range. If the year is not printed, use ${year}; but if that puts the date more
  than ~2 months in the FUTURE, use ${year - 1} instead.
- "validTo": the LAST day the prices are in effect, same "YYYY-MM-DD" format —
  the END of the range. If only one date is printed, set validTo = validFrom.
- "confidence": integer 0-100 — how sure you are of the store name AND both dates
  together. Lower it a lot if you are inferring a year or can't see a clear range.

Use "" for validFrom / validTo if no on-page date tells you the range. Do not
guess a range from the season or from the page's copyright date.`;
}

const META_SCHEMA = {
  type: 'OBJECT',
  properties: {
    store: {type: 'STRING'},
    validFrom: {type: 'STRING'},
    validTo: {type: 'STRING'},
    confidence: {type: 'INTEGER'},
  },
  required: ['store', 'validFrom', 'validTo', 'confidence'],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Keep only a well-formed, real calendar date; anything else becomes ''.
function cleanDate(value) {
  const s = (value ?? '').toString().trim();
  if (!ISO_DATE.test(s)) {
    return '';
  }
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s
    ? ''
    : s;
}

/**
 * Pull the store name and price-validity window off page 1.
 *
 * @param {string} page1Jpeg  base64 JPEG of page 1 (no data: prefix)
 * @returns {Promise<{ meta: { store: string, validFrom: string, validTo: string, confidence: number|null }, usage: object }>}
 */
export async function extractFlyerMeta(page1Jpeg) {
  const empty = {store: '', validFrom: '', validTo: '', confidence: null};

  if (process.env.GEMINI_API_KEY === 'MOCK') {
    return {
      meta: {
        store: 'Mock Mart',
        validFrom: '2026-01-01',
        validTo: '2026-01-07',
        confidence: 80,
      },
      usage: {mock: true},
    };
  }

  const {apiKey, model} = config();
  const json = await callGemini(
    {
      contents: [
        {
          parts: [
            {text: metaPrompt(new Date().getFullYear())},
            {inline_data: {mime_type: 'image/jpeg', data: page1Jpeg}},
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: META_SCHEMA,
        thinkingConfig: {thinkingBudget: 1024},
        maxOutputTokens: 2048,
      },
    },
    apiKey,
    model,
  );

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  const usage = readUsage(json);
  if (!text) {
    return {meta: empty, usage};
  }

  let meta = empty;
  try {
    const v = JSON.parse(text) || {};
    const confidence = Number(v.confidence);
    let validFrom = cleanDate(v.validFrom);
    let validTo = cleanDate(v.validTo);
    if (validFrom && !validTo) {
      validTo = validFrom;
    }
    if (validFrom && validTo && validTo < validFrom) {
      [validFrom, validTo] = [validTo, validFrom];
    }
    meta = {
      store: (v.store || '').toString().trim().slice(0, 120),
      validFrom,
      validTo,
      confidence: isFinite(confidence)
        ? Math.max(0, Math.min(100, Math.round(confidence)))
        : null,
    };
  } catch {
    // leave meta empty — the flyer still saves, just without store/dates
  }

  return {meta, usage};
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      page: {type: 'INTEGER'},
      name: {type: 'STRING'},
      priceValue: {type: 'NUMBER'},
      price: {type: 'STRING'},
      info: {type: 'STRING'},
      wasPrice: {type: 'STRING'},
      promoText: {type: 'STRING'},
      box: {type: 'ARRAY', items: {type: 'NUMBER'}},
      confidence: {type: 'INTEGER'},
      category: {type: 'STRING'},
      tags: {type: 'ARRAY', items: {type: 'STRING'}},
      department: {type: 'STRING', enum: DEPARTMENTS},
    },
    required: [
      'page',
      'name',
      'priceValue',
      'price',
      'info',
      'wasPrice',
      'promoText',
      'box',
      'confidence',
      'category',
      'tags',
      'department',
    ],
  },
};

// Generic search terms are all lowercase, punctuation-stripped, ≤4 words.
function cleanCategory(value) {
  return (value ?? '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9\s&/-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
}

// 2-8 distinct lowercase terms, none equal to the category, each ≤40 chars.
function cleanTags(value, category) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set(category ? [category] : []);
  const out = [];
  for (const raw of value) {
    const t = (raw ?? '')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9\s&/-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length > 40 || seen.has(t)) {
      continue;
    }
    seen.add(t);
    out.push(t);
    if (out.length >= 8) {
      break;
    }
  }
  return out;
}

// Fix a mangled price string ("2997" -> "$29.97"). priceValue is a number, so it
// can't lose its decimal — trust it whenever the string looks suspect.
function reconcilePrice(price, priceValue) {
  const raw = (price ?? '').trim();
  const value =
    typeof priceValue === 'number' && isFinite(priceValue) && priceValue > 0
      ? priceValue
      : null;

  if (/[¢₵]/.test(raw) || /\bfor\b|\//.test(raw)) {
    return raw;
  }
  if (/\d[.,]\d{2}\b/.test(raw)) {
    return raw.startsWith('$') ? raw : `$${raw}`;
  }

  if (/^\$?\s?\d{3,}$/.test(raw)) {
    if (value) {
      return `$${value.toFixed(2)}`;
    }
    const digits = raw.replace(/\D/g, '');
    return `$${digits.slice(0, -2)}.${digits.slice(-2)}`;
  }

  if (value) {
    return `$${value.toFixed(2)}`;
  }
  if (/^\d{1,2}$/.test(raw)) {
    return `$${raw}`;
  }
  return raw;
}

function parsePriceNumber(s) {
  const m = String(s || '')
    .replace(/,/g, '')
    .match(/\d+(?:\.\d{1,2})?/);
  return m ? parseFloat(m[0]) : null;
}

// Turn the model's wasPrice / promoText into a clean offer.
// "on sale" is strict: only true when there's a real struck-through price or an
// explicit discount callout — not just a plain flyer price.
function readOffer(rawWas, rawPromo, priceValue) {
  let wasPrice = reconcilePrice(String(rawWas || '').trim(), null);
  const promoText = String(rawPromo || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

  // Drop a "was" price that isn't actually higher than the current one — a
  // common misread where the model swaps the regular and sale figures.
  const wasNum = parsePriceNumber(wasPrice);
  const nowNum =
    typeof priceValue === 'number' && isFinite(priceValue) && priceValue > 0
      ? priceValue
      : null;
  if (wasPrice && wasNum != null && nowNum != null && wasNum <= nowNum) {
    wasPrice = '';
  }

  return {wasPrice, promoText, onSale: Boolean(wasPrice) || Boolean(promoText)};
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const n = x => x.toLocaleString('en-US');

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function config() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error(
      'GEMINI_API_KEY is not set. Copy server/.env.example to server/.env and add a free key from https://aistudio.google.com/apikey',
    );
  }
  return {apiKey, model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'};
}

async function callGemini(payload, apiKey, model) {
  const url = `${API_BASE}/${model}:generateContent`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return res.json();
    }

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
  const modality = name =>
    (u.promptTokensDetails ?? []).find(d => d.modality === name)?.tokenCount ??
    0;
  return {
    promptTokens: u.promptTokenCount ?? 0,
    promptTextTokens: modality('TEXT'),
    promptImageTokens: modality('IMAGE'),
    outputTokens: u.candidatesTokenCount ?? 0,
    thoughtsTokens: u.thoughtsTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
  };
}

// Parse Gemini's JSON array of products. If the response was truncated (a dense
// page can still overrun the output budget), salvage every complete object
// rather than failing the whole page with "Unexpected end of JSON input".
function parseProductArray(text, pageLabel, finishReason) {
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return v;
  } catch {
    // fall through to salvage
  }

  const salvaged = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          salvaged.push(JSON.parse(text.slice(objStart, i + 1)));
        } catch {
          /* skip a malformed object */
        }
        objStart = -1;
      }
    }
  }

  if (salvaged.length) {
    console.warn(
      `[gemini] pages ${pageLabel}: response truncated` +
        (finishReason ? ` (finishReason ${finishReason})` : '') +
        ` — salvaged ${salvaged.length} complete product(s)`,
    );
    return salvaged;
  }

  throw new Error(
    `Gemini response for pages ${pageLabel} could not be parsed` +
      (finishReason === 'MAX_TOKENS'
        ? ' — it was cut off by the output limit. Try PAGES_PER_REQUEST=1 or a lower MAX_DIMENSION.'
        : `: ${text.slice(0, 300)}`),
  );
}

// batch: [{ page, jpeg }]
async function extractBatch(batch, apiKey, model) {
  const pageNums = batch.map(p => p.page);
  const parts = [{text: PROMPT_HEADER}];
  for (const p of batch) {
    parts.push({text: `=== PAGE ${p.page} ===`});
    parts.push({inline_data: {mime_type: 'image/jpeg', data: p.jpeg}});
  }
  parts.push({text: PROMPT_FIELDS});

  const json = await callGemini(
    {
      contents: [{parts}],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // A bounded thinking budget — enough to reason about ambiguous digits
        // and which tile a piece of text belongs to, but capped so it can't
        // eat the whole output budget on a confusing page and truncate the JSON.
        thinkingConfig: {thinkingBudget: 2048},
        // Thinking + the JSON response share this budget. Leave generous room
        // for a dense page (40+ products, each now also carrying category + tags)
        // on top of the thinking.
        maxOutputTokens: Math.min(65536, 12000 * batch.length + 12000),
      },
    },
    apiKey,
    model,
  );

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  const finishReason = candidate?.finishReason;
  if (!text) {
    if (finishReason === 'MAX_TOKENS') {
      throw new Error(
        `Gemini response for pages ${pageNums.join(
          ', ',
        )} was cut off by the output limit before any product — try PAGES_PER_REQUEST=1 or a lower MAX_DIMENSION.`,
      );
    }
    throw new Error(
      `Unexpected Gemini response: ${JSON.stringify(json).slice(0, 500)}`,
    );
  }

  const items = parseProductArray(text, pageNums.join(', '), finishReason);
  const fallbackPage = pageNums[0];
  const products = items.map(p => {
    let page = parseInt(p.page, 10);
    if (!pageNums.includes(page)) {
      page = fallbackPage;
    }
    const priceValue =
      typeof p.priceValue === 'number' ? p.priceValue : Number(p.priceValue);
    const confidence = Number(p.confidence);
    const category = cleanCategory(p.category);
    const {wasPrice, promoText, onSale} = readOffer(
      p.wasPrice,
      p.promoText,
      priceValue,
    );
    return {
      page,
      name: (p.name || '').toString().trim(),
      price: reconcilePrice((p.price || '').toString().trim(), priceValue),
      priceValue: isFinite(priceValue) && priceValue > 0 ? priceValue : null,
      info: (p.info || '').toString().trim(),
      wasPrice,
      promoText,
      onSale,
      box:
        Array.isArray(p.box) && p.box.length === 4 ? p.box.map(Number) : null,
      confidence: isFinite(confidence)
        ? Math.max(0, Math.min(100, Math.round(confidence)))
        : null,
      category,
      tags: cleanTags(p.tags, category),
      department: cleanDepartment(p.department),
    };
  });

  return {products, usage: readUsage(json)};
}

async function appendUsageLog(entry) {
  try {
    await mkdir(dirname(LOG_FILE), {recursive: true});
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
    const products = pages.flatMap(p =>
      [
        {
          name: 'Mock Product A',
          price: '$3.99',
          priceValue: 3.99,
          info: 'each',
          wasPrice: '$4.99',
          promoText: 'Save $1',
          onSale: true,
          confidence: 92,
          category: 'snack',
          tags: ['snacks', 'chips'],
          department: 'snacks & candy',
        },
        {
          name: 'Mock Product B',
          price: '$1.49',
          priceValue: 1.49,
          info: '500 g',
          wasPrice: '',
          promoText: '',
          onSale: false,
          confidence: 88,
          category: 'yogurt',
          tags: ['dairy', 'greek yogurt'],
          department: 'dairy & eggs',
        },
        {
          name: 'Mock Product C',
          price: '$8.97',
          priceValue: 8.97,
          info: 'Selected varieties',
          wasPrice: '',
          promoText: '2 for $16',
          onSale: true,
          confidence: 41,
          category: 'laundry detergent',
          tags: ['detergent', 'soap'],
          department: 'laundry',
        },
      ].map((m, j) => ({
        id: `${p.page}-${j}`,
        page: p.page,
        ...m,
        box: [j * 300 + 40, 40, j * 300 + 280, 470],
      })),
    );
    return {products, usage: {calls: 0, mock: true}};
  }

  const {apiKey, model} = config();
  const batches = chunk(pages, PAGES_PER_REQUEST);

  const results = new Array(batches.length);
  const requests = new Array(batches.length);
  const failedPages = [];
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= batches.length) {
        return;
      }
      const batch = batches[i];
      const label = batch.map(p => p.page).join(',');
      const started = Date.now();

      let products;
      let usage;
      try {
        ({products, usage} = await extractBatch(batch, apiKey, model));
      } catch (err) {
        // One bad page shouldn't lose the whole flyer — record it and move on.
        failedPages.push(...batch.map(p => p.page));
        results[i] = [];
        console.warn(`[gemini] pages ${label} FAILED: ${err.message}`);
        continue;
      }
      const ms = Date.now() - started;

      requests[i] = {
        pages: batch.map(p => p.page),
        products: products.length,
        ms,
        ...usage,
      };
      results[i] = products;

      console.log(
        `[gemini] pages ${label}  ` +
          `prompt=${n(usage.promptTokens)} (text ${n(
            usage.promptTextTokens,
          )}, image ${n(usage.promptImageTokens)})  ` +
          `output=${n(usage.outputTokens)}  thoughts=${n(
            usage.thoughtsTokens,
          )}  ` +
          `total=${n(usage.totalTokens)}  ${products.length} products  ${(
            ms / 1000
          ).toFixed(1)}s`,
      );
    }
  }

  await Promise.all(
    Array.from({length: Math.min(REQUEST_CONCURRENCY, batches.length)}, worker),
  );

  const flat = results.flat().map((p, i) => ({id: `${p.page}-${i}`, ...p}));

  if (!flat.length && failedPages.length) {
    throw new Error(
      `Extraction failed for every page (${failedPages.length}). See server logs.`,
    );
  }
  if (failedPages.length) {
    failedPages.sort((a, b) => a - b);
    console.warn(`[gemini] ${failedPages.length} page(s) failed: ${failedPages.join(', ')}`);
  }

  const total = requests.filter(Boolean).reduce(
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
      `prompt=${n(total.promptTokens)} (image ${n(
        total.promptImageTokens,
      )})  ` +
      `output=${n(total.outputTokens)}  thoughts=${n(
        total.thoughtsTokens,
      )}  total=${n(total.totalTokens)}`,
  );

  await appendUsageLog({
    at: new Date().toISOString(),
    model,
    pagesPerRequest: PAGES_PER_REQUEST,
    pages: pages.length,
    products: flat.length,
    failedPages,
    requests: requests.filter(Boolean),
    total,
  });

  return {
    products: flat,
    usage: {
      model,
      pagesPerRequest: PAGES_PER_REQUEST,
      perRequest: requests.filter(Boolean),
      total,
      failedPages,
    },
  };
}

// --- Text-only categorisation (backfill) ------------------------------------
// Give already-extracted products a generic "category" + "tags" without
// re-rasterising or re-running vision — just the names go up.

const CATEGORY_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      ref: {type: 'INTEGER'},
      category: {type: 'STRING'},
      tags: {type: 'ARRAY', items: {type: 'STRING'}},
    },
    required: ['ref', 'category', 'tags'],
  },
};

const CATEGORY_PROMPT = `You are given a numbered list of retail flyer product names, some with a
size/detail note in parentheses. For EACH item, return how a shopper would find
it WITHOUT knowing the brand.

- "ref": the item's number, copied exactly.
- "category": 1-4 words, lowercase, no brand, no size, no packaging words — the
  everyday term a shopper types. Prefer the plain word over a marketing one:
  "ice milk" -> "ice cream", "soy beverage" -> "plant-based milk",
  "Athena Club full body dry spray deodorant" -> "body spray deodorant",
  "Lactantia lactose free cream" -> "cream". English only.
- "tags": 2-6 lowercase alternative search terms — synonyms, the bare noun, the
  aisle word, a broader and a narrower term, e.g.
  ["deodorant", "body spray", "antiperspirant"]. No brands, no sizes, and do not
  just repeat "category".

Return exactly one object per input item, nothing else.`;

/**
 * @param {Array<{ ref: number, name: string, info?: string }>} items
 * @returns {Promise<{ result: Map<number, { category: string, tags: string[] }>, usage: object }>}
 */
export async function categorizeProducts(items) {
  if (process.env.GEMINI_API_KEY === 'MOCK') {
    return {
      result: new Map(
        items.map(it => [it.ref, {category: 'mock category', tags: ['mock']}]),
      ),
      usage: {mock: true},
    };
  }

  const {apiKey, model} = config();
  const lines = items
    .map(it => `${it.ref}. ${it.name}${it.info ? ` (${it.info})` : ''}`)
    .join('\n');

  const json = await callGemini(
    {
      contents: [{parts: [{text: CATEGORY_PROMPT}, {text: lines}]}],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: CATEGORY_SCHEMA,
        thinkingConfig: {thinkingBudget: 256},
        maxOutputTokens: Math.min(65536, 260 * items.length + 4000),
      },
    },
    apiKey,
    model,
  );

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? '';
  const finishReason = candidate?.finishReason;

  const result = new Map();
  for (const r of parseObjectArray(text)) {
    const ref = Number(r.ref);
    if (!Number.isInteger(ref)) {
      continue;
    }
    const category = cleanCategory(r.category);
    if (!category) {
      continue;
    }
    result.set(ref, {category, tags: cleanTags(r.tags, category)});
  }

  return {result, usage: readUsage(json), finishReason};
}

// Parse a JSON array of flat objects, salvaging every complete object if the
// response was truncated (same trick parseProductArray uses for products).
function parseObjectArray(text) {
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) {
      return v;
    }
  } catch {
    // fall through to salvage
  }
  const out = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* skip */
        }
        start = -1;
      }
    }
  }
  return out;
}

// --- Department assignment (backfill) ---------------------------------------
// Coarser than category. Given a list of generic categories (or names), assign
// each to one fixed store aisle. Cheap: run it over the DISTINCT categories, not
// every product.

const DEPARTMENT_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      ref: {type: 'INTEGER'},
      department: {type: 'STRING', enum: DEPARTMENTS},
    },
    required: ['ref', 'department'],
  },
};

const DEPARTMENT_PROMPT = `You are given a numbered list of generic grocery / retail product types. Assign
EACH to exactly ONE store department from this list, lowercase, copied verbatim:
${DEPARTMENTS.join(', ')}.

- "ref": the item's number, copied exactly.
- "department": one value from the list. Pick the aisle a shopper physically
  walks to. Fresh whole fruit -> "fruit"; fresh whole vegetables ->
  "vegetables"; anything frozen -> "frozen"; milk/cheese/yogurt/butter/eggs
  (incl. chocolate milk) -> "dairy & eggs"; soda/juice/water/coffee ->
  "beverages"; chips/candy/cookies -> "snacks & candy"; laundry detergent/
  fabric softener/stain remover -> "laundry"; dish soap/cleaners/trash bags ->
  "household & cleaning"; paper towels/toilet paper/napkins -> "paper goods";
  shampoo/deodorant/makeup -> "beauty & personal care"; vitamins/medicine/first
  aid -> "health & wellness". Use "other" only when nothing else fits.

Return exactly one object per input item.`;

/**
 * @param {Array<{ ref: number, text: string }>} items  ref + the category or name
 * @returns {Promise<{ result: Map<number, string>, usage: object, finishReason?: string }>}
 */
export async function assignDepartments(items) {
  if (process.env.GEMINI_API_KEY === 'MOCK') {
    return {
      result: new Map(items.map(it => [it.ref, 'other'])),
      usage: {mock: true},
    };
  }

  const {apiKey, model} = config();
  const lines = items.map(it => `${it.ref}. ${it.text}`).join('\n');

  const json = await callGemini(
    {
      contents: [{parts: [{text: DEPARTMENT_PROMPT}, {text: lines}]}],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: DEPARTMENT_SCHEMA,
        thinkingConfig: {thinkingBudget: 256},
        maxOutputTokens: Math.min(65536, 40 * items.length + 4000),
      },
    },
    apiKey,
    model,
  );

  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? '';
  const finishReason = candidate?.finishReason;

  const result = new Map();
  for (const r of parseObjectArray(text)) {
    const ref = Number(r.ref);
    if (Number.isInteger(ref)) {
      result.set(ref, cleanDepartment(r.department));
    }
  }

  return {result, usage: readUsage(json), finishReason};
}

// ---------------------------------------------------------------------------
// Chat agent — turns a shopper's message into either search terms or a reply.
// One Gemini call per turn, no tool round-trip: the model returns a single
// structured object and the server acts on it directly.
// ---------------------------------------------------------------------------

const CHAT_SYSTEM = `You are the shopping assistant in a grocery-flyer app. Users search products pulled from local store flyers.

If the user names a product or a product category (even a broad one like "medication" or "snacks"), use action "search":
- "terms": specific lowercase words for it — plain word, singular/plural, close synonyms, 2-4 flyer brand names. No broad aisle words ("food", "produce", "dairy"). Max 8, no duplicates, <=3 words each.
- "must": ONLY when the user restricts the search ("for kids", "gluten free", "unsalted", "just Metro") — words a result must ALSO contain, expanded like terms; keep the earlier "terms" and add the restriction here. "for kids" -> ["child","children","childrens","kids","infant","toddler","junior"]. Else [].
- "intent": what they want, 1-4 words, no verbs — "grapes", "kids medication".

Otherwise use action "reply" (1-2 sentences). Don't answer general-knowledge questions — say you only help find flyer products.

Fill every field; unused ones "" or [].`;

const CHAT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    action: {type: 'STRING', enum: ['search', 'reply']},
    terms: {type: 'ARRAY', items: {type: 'STRING'}},
    must: {type: 'ARRAY', items: {type: 'STRING'}},
    intent: {type: 'STRING'},
    reply: {type: 'STRING'},
  },
  required: ['action', 'terms', 'must', 'intent', 'reply'],
};

const GENERIC_REPLY =
  'I can only help you find products in the flyers. Try "find me some grapes" or "I need toilet paper".';

// Same character rules as cleanCategory: lowercase, drop punctuation, collapse
// whitespace. Keep 2-40 chars, at most 3 words. Dedupe, cap at 10.
function cleanTerms(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const t = (raw ?? '')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9\s&/-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length < 2 || t.length > 40 || t.split(' ').length > 3) {
      continue;
    }
    if (seen.has(t)) {
      continue;
    }
    seen.add(t);
    out.push(t);
    if (out.length >= 10) {
      break;
    }
  }
  return out;
}

/**
 * @param {Array<{ role: 'user'|'assistant', content: string }>} messages
 *   Trimmed recent history, ending with the new user turn.
 * @returns {Promise<
 *   | { kind: 'search', terms: string[], must: string[], intent: string, usage: object }
 *   | { kind: 'reply', text: string, usage: object }
 * >}
 */
export async function chatAgent(messages) {
  const lastUser = messages[messages.length - 1]?.content ?? '';

  if (process.env.GEMINI_API_KEY === 'MOCK') {
    return {
      kind: 'search',
      terms: cleanTerms(
        lastUser
          .toLowerCase()
          .split(/\s+/)
          .filter(w => w.length > 2),
      ),
      must: [],
      intent: lastUser.slice(0, 40),
      usage: {mock: true},
    };
  }

  const {apiKey, model} = config();

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{text: m.content}],
  }));

  const json = await callGemini(
    {
      systemInstruction: {parts: [{text: CHAT_SYSTEM}]},
      contents,
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: CHAT_SCHEMA,
        thinkingConfig: {thinkingBudget: 0},
        maxOutputTokens: 256,
      },
    },
    apiKey,
    model,
  );

  const cand = json.candidates?.[0];
  const text = cand?.content?.parts?.[0]?.text ?? '';
  const usage = readUsage(json);

  let parsed = {};
  try {
    parsed = JSON.parse(text) || {};
  } catch {
    // truncated / non-JSON — fall through to the generic reply
  }

  const terms = cleanTerms(parsed.terms);
  const must = cleanTerms(parsed.must);
  const result =
    parsed.action === 'search' && terms.length
      ? {
          kind: 'search',
          terms,
          must,
          intent: String(parsed.intent || '').slice(0, 60),
          usage,
        }
      : {
          kind: 'reply',
          text: (String(parsed.reply || '').trim() || GENERIC_REPLY).slice(
            0,
            400,
          ),
          usage,
        };

  console.log(
    `[gemini] chat ${result.kind}  turns=${messages.length}  prompt=${n(
      usage.promptTokens,
    )} output=${n(usage.outputTokens)} thoughts=${n(
      usage.thoughtsTokens,
    )} total=${n(usage.totalTokens)}` +
      (result.kind === 'search'
        ? `  [${result.terms.join(', ')}]` +
          (result.must.length ? `  must:[${result.must.join(', ')}]` : '')
        : ''),
  );

  await appendUsageLog({
    at: new Date().toISOString(),
    op: 'chat',
    model,
    turns: messages.length,
    kind: result.kind,
    terms: result.kind === 'search' ? result.terms : [],
    must: result.kind === 'search' ? result.must : [],
    ...usage,
  });

  return result;
}
