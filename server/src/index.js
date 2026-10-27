import './loadEnv.js';
import './logger.js';

import {createHash} from 'node:crypto';
import {networkInterfaces} from 'node:os';

import cors from 'cors';
import express from 'express';
import multer from 'multer';

import {runCanonicalMatchingBatch} from './canonicalMatch.js';
import {
  PAGES_DIR,
  THUMBS_DIR,
  cancelAlerts,
  createAlert,
  departmentCounts,
  filterFacets,
  findFlyerByHash,
  getOrCreateUser,
  listAlerts,
  priceHistory,
  priceInsight,
  productCountForFlyer,
  resolveCanonicalId,
  resolveCanonicalIds,
  saveExtraction,
  searchProducts,
  searchProductsExpanded,
  todayIso,
  totalProducts,
} from './db.js';
import {chatAgent, extractFlyer, extractFlyerMeta} from './gemini.js';
import {renderPdf} from './pdf.js';
import {renderThumbs} from './thumbs.js';

// Runs the canonical-product matching pass after every upload, without
// blocking the upload response — see server/src/canonicalMatch.js. A simple
// lock + "run again" flag means overlapping uploads never run it twice at
// once; the second just gets its own pass right after the first finishes.
let canonicalMatchRunning = false;
let canonicalMatchQueued = false;

function triggerCanonicalMatching() {
  if (canonicalMatchRunning) {
    canonicalMatchQueued = true;
    return;
  }
  canonicalMatchRunning = true;
  runCanonicalMatchingBatch({log: () => {}})
    .then(({done, created, calls, tokens}) => {
      if (done) {
        console.log(
          `[canonical-match] linked ${done} product(s), ${created} new canonical product(s), ` +
            `${calls} Gemini call(s), ${tokens} tokens`,
        );
      }
    })
    .catch(err => console.error('[canonical-match] failed:', err))
    .finally(() => {
      canonicalMatchRunning = false;
      if (canonicalMatchQueued) {
        canonicalMatchQueued = false;
        triggerCanonicalMatching();
      }
    });
}

/** First non-internal IPv4 address — the one a phone on the same Wi-Fi uses. */
function lanAddress() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        return a.address;
      }
    }
  }
  return null;
}

const PORT = process.env.PORT || 3001;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 50;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_UPLOAD_BYTES},
});

// Turn multer's size/field errors into a readable 4xx instead of a bare 500.
function handleUpload(req, res, next) {
  upload.single('file')(req, res, err => {
    if (!err) {
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `That PDF is larger than the ${MAX_UPLOAD_MB} MB limit. Split it or lower its resolution, or raise MAX_UPLOAD_MB on the server.`,
      });
    }
    return res.status(400).json({error: err.message || 'Upload failed'});
  });
}

const app = express();
app.use(cors());

// One line per request — shows the phone's traffic hitting the server live.
app.use((req, res, next) => {
  const t0 = Date.now();
  const ip = String(
    req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
  ).replace('::ffff:', '');
  res.on('finish', () => {
    console.log(
      `[req] ${ip}  ${req.method} ${req.originalUrl}  ${res.statusCode}  ${
        Date.now() - t0
      }ms`,
    );
  });
  next();
});

// Page images + per-product crop thumbnails, served straight off disk.
const staticOpts = {immutable: true, maxAge: '30d'};
app.use('/pages', express.static(PAGES_DIR, staticOpts));
app.use('/thumbs', express.static(THUMBS_DIR, staticOpts));

const baseUrlOf = req => `${req.protocol}://${req.get('host')}`;

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    gemini: process.env.GEMINI_API_KEY ? 'configured' : 'missing',
    products: totalProducts(),
  });
});

// Extraction jobs, keyed by the PDF's sha256 (doubles as the job id the app
// polls). If the phone locks and the app's connection dies mid-extraction,
// re-posting the same PDF attaches to the running job instead of starting a
// second (wasted) Gemini pass — same reason a finished job is kept around
// briefly (JOB_RETENTION_MS) after it settles rather than cleared instantly,
// so a poll that lands right after completion still sees the result. A
// flyer that finished a while ago is deduped by findFlyerByHash instead.
const inFlight = new Map();
const JOB_RETENTION_MS = 2 * 60 * 1000;

/** The same summary shape `runExtraction` produces, for an already-stored flyer. */
function resultFromExisting(existing) {
  return {
    flyerId: existing.id,
    name: existing.name,
    savedProducts: productCountForFlyer(existing.id),
    renderedPages: existing.rendered_pages,
    totalPages: existing.total_pages,
    store: existing.store || '',
    validFrom: existing.valid_from || '',
    validTo: existing.valid_to || '',
    failedPages: [],
    reused: true,
  };
}

/** `{ jobId, state, progress, result?, error? }` — what both the kickoff POST
 * and the status GET return for a job. */
function jobStatusResponse(job, jobId) {
  return {
    jobId,
    state: job.state,
    progress: job.progress,
    result: job.state === 'done' ? job.result : undefined,
    error: job.state === 'error' ? job.error : undefined,
  };
}

// Kicks off extraction in the background and tracks its progress/result on a
// plain object in `inFlight` — the route handlers never await this directly,
// so POST /flyers/extract can answer immediately and the app polls the
// status route for updates instead of blocking on one long request.
function startJob(hash, {buffer, name, rendered, maxPages}) {
  const job = {
    state: 'processing',
    progress: {done: 0, total: rendered.pages.length},
    result: null,
    error: null,
  };
  inFlight.set(hash, job);

  runExtraction({
    buffer,
    name,
    hash,
    rendered,
    maxPages,
    onPage: n => {
      job.progress.done = Math.min(job.progress.total, job.progress.done + n);
    },
  })
    .then(result => {
      job.state = 'done';
      job.result = result;
    })
    .catch(err => {
      console.error('[extract] failed:', err);
      job.state = 'error';
      job.error = err?.message || 'Extraction failed';
    })
    .finally(() => {
      setTimeout(() => {
        if (inFlight.get(hash) === job) {
          inFlight.delete(hash);
        }
      }, JOB_RETENTION_MS).unref?.();
    });

  return job;
}

async function runExtraction({buffer, name, hash, rendered, maxPages, onPage}) {
  const t0 = Date.now();
  const [{products, usage, pageDates}, metaResult] = await Promise.all([
    extractFlyer(rendered.pages.map(p => ({page: p.page, jpeg: p.jpegBase64})), {
      onPage,
    }),
    extractFlyerMeta(rendered.pages[0].jpegBase64).catch(err => {
      console.warn(`[gemini] flyer-meta failed: ${err.message}`);
      return null;
    }),
  ]);

  let meta = metaResult?.meta ?? null;
  // Page 1 doesn't always carry the flyer's effective-dates line (it can be a
  // teaser/highlights page instead of the masthead) — fall back to whichever
  // OTHER page's product-extraction call spotted that statement, no extra
  // Gemini call needed since every page is already extracted for products.
  // Take the lowest-numbered page that has one; leave store/confidence as
  // page 1 found them.
  if (!meta?.validFrom || !meta?.validTo) {
    const fallback = pageDates
      .filter(d => d.validFrom && d.validTo)
      .sort((a, b) => a.page - b.page)[0];
    if (fallback) {
      console.log(
        `[gemini] flyer-meta  page 1 had no dates — using page ${fallback.page}'s ` +
          `${fallback.validFrom}..${fallback.validTo} instead`,
      );
      meta = {
        store: meta?.store || '',
        validFrom: fallback.validFrom,
        validTo: fallback.validTo,
        confidence: meta?.confidence ?? null,
      };
    }
  }

  if (meta) {
    const mu = metaResult?.usage || {};
    console.log(
      `[gemini] flyer-meta  store=${JSON.stringify(meta.store)}  ` +
        `valid=${meta.validFrom || '?'}..${meta.validTo || '?'}  ` +
        `confidence=${meta.confidence ?? '?'}  ` +
        `prompt=${mu.promptTokens ?? 0} (image ${mu.promptImageTokens ?? 0})  ` +
        `output=${mu.outputTokens ?? 0}  thoughts=${mu.thoughtsTokens ?? 0}  ` +
        `total=${mu.totalTokens ?? 0}`,
    );
  }

  let thumbs;
  try {
    thumbs = renderThumbs(buffer, products, {maxPages});
  } catch (err) {
    console.warn(`[thumbs] skipped: ${err.message}`);
  }

  const {flyerId, savedProducts} = saveExtraction({
    name,
    hash,
    totalPages: rendered.totalPages,
    renderedPages: rendered.renderedPages,
    pages: rendered.pages,
    products,
    thumbs,
    meta,
  });

  console.log(
    `[extract] ${name} — ${rendered.renderedPages} page(s), ` +
      `${savedProducts} product(s) saved, ${((Date.now() - t0) / 1000).toFixed(
        1,
      )}s`,
  );

  // Fire-and-forget — groups the new products into canonical products (price
  // history's identity layer) without adding latency to this response.
  triggerCanonicalMatching();

  return {
    flyerId,
    name,
    savedProducts,
    renderedPages: rendered.renderedPages,
    totalPages: rendered.totalPages,
    store: meta?.store || '',
    validFrom: meta?.validFrom || '',
    validTo: meta?.validTo || '',
    failedPages: usage.failedPages ?? [],
    reused: false,
  };
}

/**
 * POST /flyers/extract   (multipart/form-data, field "file" = the flyer PDF)
 *
 * Kicks off (or attaches to) extraction and answers right away with
 * `{ jobId, state, progress, result?, error? }` — it does NOT wait for
 * extraction to finish. `state` is 'processing' (poll GET below), 'done'
 * (already stored, or finished so fast — e.g. MOCK mode — that `result` is
 * already attached), or 'error'. Re-posting the same PDF is safe: it just
 * attaches to (or re-reports) the same job, deduped by content hash.
 */
app.post('/flyers/extract', handleUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({error: 'No PDF uploaded — send it as multipart field "file".'});
    }
    if (req.file.mimetype && !req.file.mimetype.includes('pdf')) {
      return res
        .status(415)
        .json({error: `Expected a PDF, got "${req.file.mimetype}".`});
    }

    const name = req.file.originalname || 'flyer.pdf';
    const hash = createHash('sha256').update(req.file.buffer).digest('hex');

    const existing = findFlyerByHash(hash);
    if (existing) {
      console.log(`[extract] ${name} — already stored, skipping Gemini`);
      const result = resultFromExisting(existing);
      return res.json({
        jobId: hash,
        state: 'done',
        progress: {done: result.renderedPages, total: result.renderedPages},
        result,
      });
    }

    const maxPages = req.query.maxpages
      ? Number(req.query.maxpages)
      : undefined;

    let job = inFlight.get(hash);
    if (job) {
      console.log(`[extract] ${name} — attaching to the in-flight job`);
    } else {
      let rendered;
      try {
        rendered = renderPdf(req.file.buffer, {maxPages});
      } catch (err) {
        return res
          .status(422)
          .json({error: `Could not read the PDF: ${err.message}`});
      }
      if (!rendered.pages.length) {
        return res
          .status(422)
          .json({error: 'The PDF has no renderable pages.'});
      }

      job = startJob(hash, {buffer: req.file.buffer, name, rendered, maxPages});
    }

    res.json(jobStatusResponse(job, hash));
  } catch (err) {
    console.error('[extract] failed:', err);
    if (!res.writableEnded) {
      res.status(500).json({error: err?.message || 'Extraction failed'});
    }
  }
});

/**
 * GET /flyers/extract/:jobId/status -> { jobId, state, progress, result?, error? }
 * `jobId` is the sha256 POST /flyers/extract returned. Poll this until
 * `state` isn't 'processing'. If the in-memory job already finished and was
 * cleared (or the server restarted), falls back to the persisted flyer so a
 * trailing poll still resolves; a truly unknown id is a 404.
 */
app.get('/flyers/extract/:jobId/status', (req, res) => {
  const {jobId} = req.params;
  const job = inFlight.get(jobId);
  if (job) {
    return res.json(jobStatusResponse(job, jobId));
  }
  const existing = findFlyerByHash(jobId);
  if (existing) {
    const result = resultFromExisting(existing);
    return res.json({
      jobId,
      state: 'done',
      progress: {done: result.renderedPages, total: result.renderedPages},
      result,
    });
  }
  res
    .status(404)
    .json({jobId, state: 'error', error: 'Unknown or expired upload job.'});
});

/**
 * GET /products?q=<text>&limit=20&offset=0
 *   -> { groups: [{ groupKey, label, storeCount, products: [{ id, flyerId, page,
 *          name, price, priceValue, info, box, confidence, ... }] }],
 *        pages: [{ flyerId, page, width, height, image }],   image = absolute URL
 *        totalGroups, totalProducts, hasMore }
 * `limit`/`offset` paginate groups (canonical products), not individual
 * products — see searchProducts() in db.js.
 */
app.get('/products', (req, res) => {
  try {
    const result = searchProducts(
      {
        q: req.query.q,
        departments: req.query.department,
        stores: req.query.store,
        statuses: req.query.status,
        includeExpired: req.query.expired,
        expiredOnly: req.query.expiredOnly,
        onSale: req.query.sale,
        limit: req.query.limit,
        offset: req.query.offset,
      },
      baseUrlOf(req),
    );
    res.json(result);
  } catch (err) {
    console.error('[products] failed:', err);
    res.status(500).json({error: err?.message || 'Query failed'});
  }
});

/** GET /departments -> { departments: [{ department, count }] } busiest first. */
app.get('/departments', (_req, res) => {
  try {
    res.json({departments: departmentCounts()});
  } catch (err) {
    console.error('[departments] failed:', err);
    res.status(500).json({error: err?.message || 'Query failed'});
  }
});

/**
 * GET /filters -> { departments, stores, statuses }, each [{ value, count }].
 * Feeds the Search filter modal. `statuses` omits states no product is in.
 */
app.get('/filters', (req, res) => {
  try {
    res.json(
      filterFacets({
        q: req.query.q,
        departments: req.query.department,
        stores: req.query.store,
        statuses: req.query.status,
        includeExpired: req.query.expired,
        expiredOnly: req.query.expiredOnly,
        onSale: req.query.sale,
      }),
    );
  } catch (err) {
    console.error('[filters] failed:', err);
    res.status(500).json({error: err?.message || 'Query failed'});
  }
});

/**
 * GET /price-history/:canonicalProductId?store=&months=
 *   -> { history: [{ price, priceValue, onSale, store, validFrom, validTo, flyerId, page }] }
 * Chronological sightings of one canonical product across every flyer it's
 * appeared in, e.g. "$4.99 today; previous: $5.49, $4.49, $5.99".
 */
app.get('/price-history/:canonicalProductId', (req, res) => {
  try {
    const history = priceHistory(req.params.canonicalProductId, {
      store: req.query.store,
      months: req.query.months ? Number(req.query.months) : undefined,
    });
    res.json({history});
  } catch (err) {
    console.error('[price-history] failed:', err);
    res.status(500).json({error: err?.message || 'Query failed'});
  }
});

/**
 * GET /price-insight/:canonicalProductId?store=
 *   -> { currentPrice, min90d, median90d, isLowestIn3Months, isLowestIn6Months,
 *        isLowestIn12Months, dealQuality, saleFrequencyDays, byStore, sightings }
 * One aggregate over the price history — deal quality, lowest-price tracking,
 * retailer comparison and sale-frequency all come from this single endpoint.
 */
app.get('/price-insight/:canonicalProductId', (req, res) => {
  try {
    const insight = priceInsight(req.params.canonicalProductId, {
      store: req.query.store,
    });
    if (!insight) {
      return res.status(404).json({error: 'No price history for this product yet.'});
    }
    res.json(insight);
  } catch (err) {
    console.error('[price-insight] failed:', err);
    res.status(500).json({error: err?.message || 'Query failed'});
  }
});

const userIdOf = req => {
  const id = req.header('x-user-id');
  return typeof id === 'string' && id.trim() ? id.trim().slice(0, 100) : null;
};

/** GET /alerts -> { alerts: [...] } for the device sending X-User-Id. */
app.get('/alerts', (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) {
      return res.status(400).json({error: 'Missing X-User-Id header.'});
    }
    res.json({alerts: listAlerts(userId)});
  } catch (err) {
    console.error('[alerts] failed:', err);
    res.status(500).json({error: err?.message || 'Query failed'});
  }
});

/**
 * POST /alerts  { canonicalProductId, targetPrice, comparison?, store? }
 *   -> { id }
 * Creates a price alert for the device sending X-User-Id (created on first use).
 */
app.post('/alerts', express.json({limit: '4kb'}), (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) {
      return res.status(400).json({error: 'Missing X-User-Id header.'});
    }
    const {canonicalProductId, targetPrice, comparison, store} = req.body || {};
    if (!canonicalProductId || !(Number(targetPrice) > 0)) {
      return res
        .status(400)
        .json({error: 'canonicalProductId and a positive targetPrice are required.'});
    }
    getOrCreateUser(userId);
    const id = createAlert({
      userId,
      canonicalProductId,
      targetPrice: Number(targetPrice),
      comparison: comparison === 'lt' ? 'lt' : 'lte',
      store: store || null,
    });
    res.status(201).json({id});
  } catch (err) {
    console.error('[alerts] failed:', err);
    res.status(500).json({error: err?.message || 'Could not create alert'});
  }
});

// For a "search" chat reply: state the cheapest currently-active match, and
// call out an upcoming one only when it's actually cheaper (never just
// present, to avoid noise). `products` is already filtered to non-expired
// statuses by the caller, so "active" here just means "not upcoming yet".
function cheapestPriceNote(products, today) {
  const priced = products.filter(p => Number.isFinite(p.priceValue));
  const isUpcoming = p => !!p.validFrom && p.validFrom > today;
  const cheapestOf = list =>
    list.length ? list.reduce((a, b) => (b.priceValue < a.priceValue ? b : a)) : null;
  const active = cheapestOf(priced.filter(p => !isUpcoming(p)));
  const upcoming = cheapestOf(priced.filter(isUpcoming));

  if (active) {
    const note = ` Cheapest right now: ${active.price} at ${active.store}.`;
    return upcoming && upcoming.priceValue < active.priceValue
      ? note +
          ` An upcoming flyer has it cheaper — ${upcoming.price} at ` +
          `${upcoming.store} starting ${formatWeekOf(upcoming.validFrom)}.`
      : note;
  }
  return upcoming
    ? ` Nothing active right now, but an upcoming flyer has it for ` +
        `${upcoming.price} at ${upcoming.store} starting ` +
        `${formatWeekOf(upcoming.validFrom)}.`
    : '';
}

// Runs one product group's search (a "search" chat turn covers 1+ of these,
// e.g. "tomatoes" and "chips" for "price of tomatoes and chips") and composes
// that group's own reply sentence, reusing the same rules as a single-product
// search: only state a cheapest-price note for an "item"-scope, non-expired
// group, since a "broad" aisle group spans unrelated products.
// "snacks & candy" -> "Snacks & Candy" for the reply text.
const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());

function runSearchGroup(group, baseUrl, includeExpired, limit) {
  const {products, pages, terms, must, total} = searchProductsExpanded(
    group.terms,
    baseUrl,
    {
      limit,
      must: group.must,
      broad: group.scope === 'broad',
      includeExpired,
      stores: group.stores,
      department: group.department,
    },
  );
  const label = group.intent || group.department || terms[0] || 'that';
  const storeNote = group.stores.length ? ` at ${group.stores.join(' and ')}` : '';
  const expiredNote = includeExpired ? ', including expired flyers' : '';
  const countNote = total > products.length ? ` (showing ${products.length})` : '';
  const priceNote =
    products.length && group.scope === 'item' && !includeExpired
      ? cheapestPriceNote(products, todayIso())
      : '';
  // A department match (group.department set) returns EVERY product in that
  // aisle, not just ones matching "label" — e.g. "chips" can pull in all of
  // Snacks & Candy, cookies and chocolate bars included. Say so plainly
  // instead of implying all `total` results are "chips" matches.
  const reply = !products.length
    ? `I couldn't find anything for "${label}"${storeNote} in the flyers right now.` +
      (terms.length
        ? ` I searched: ${terms.join(', ')}${must.length ? `, filtered to: ${must.join(', ')}` : ''}.`
        : '')
    : group.department
    ? `Browsing all of "${titleCase(group.department)}"${storeNote}${expiredNote} — ` +
      `${total} item${total === 1 ? '' : 's'} in that aisle${countNote}, ` +
      `not filtered down to just "${label}".`
    : `Found ${total} match${total === 1 ? '' : 'es'} for "${label}"${storeNote}${expiredNote}${countNote}.` +
      priceNote;
  return {label, products, pages, terms, must, total, reply};
}

// Dedupe flyer pages across several {pages: [...]} results (multiple search
// groups, multiple budget items, ...) that likely share a source flyer.
function mergePages(resultsWithPages) {
  const pages = [];
  const seen = new Set();
  for (const r of resultsWithPages) {
    for (const p of r.pages) {
      const key = `${p.flyerId}:${p.page}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      pages.push(p);
    }
  }
  return pages;
}

// "compare_stores" chat turn — one specific item, priced at each of the 2+
// named stores. Every number in the reply is the actual cheapest current
// listing at that store, never a Gemini guess.
function runStoreCompare(agent, baseUrl) {
  // department is deliberately never passed through here: a department
  // match returns EVERY product in that aisle (inclusion isn't term-based
  // at all — see runSearchGroup's own comment on this), so "cheapest
  // ground beef" could silently become "cheapest thing in Meat & Seafood",
  // e.g. pork chops. A comparison is always about the one named item.
  const {products, pages, terms} = searchProductsExpanded(agent.terms, baseUrl, {
    limit: 50,
    must: agent.must,
    broad: agent.scope === 'broad',
    includeExpired: false,
    stores: agent.stores,
  });
  const label = agent.intent || agent.department || terms[0] || 'that';

  // Cheapest current listing per requested store (undefined where there's
  // no match at all).
  const byStore = new Map();
  for (const p of products) {
    if (!Number.isFinite(p.priceValue)) {
      continue;
    }
    const cur = byStore.get(p.store);
    if (!cur || p.priceValue < cur.priceValue) {
      byStore.set(p.store, p);
    }
  }

  const rows = agent.stores.map(store => ({store, product: byStore.get(store) || null}));
  const found = rows.filter(r => r.product);
  const missing = rows.filter(r => !r.product).map(r => r.store);
  const missingNote = missing.length
    ? ` No current listing at ${missing.join(' or ')}.`
    : '';

  let reply;
  if (!found.length) {
    reply = `I couldn't find "${label}" at ${agent.stores.join(' or ')} right now.`;
  } else if (found.length === 1) {
    reply = `"${label}" is ${found[0].product.price} at ${found[0].store}.${missingNote}`;
  } else {
    const sorted = [...found].sort((a, b) => a.product.priceValue - b.product.priceValue);
    const cheapest = sorted[0];
    const rest = sorted.slice(1);
    const tied = rest.length && rest[0].product.priceValue === cheapest.product.priceValue;
    reply = tied
      ? `"${label}" is the same price at ${sorted
          .map(r => `${r.store} (${r.product.price})`)
          .join(' and ')}.${missingNote}`
      : `"${label}" is cheaper at ${cheapest.store} — ${cheapest.product.price} vs ` +
        `${rest.map(r => `${r.product.price} at ${r.store}`).join(', ')}.${missingNote}`;
  }

  return {
    reply,
    groups: found.length
      ? [
          {
            label,
            products: found.map(r => r.product),
            terms,
            must: agent.must,
            total: found.length,
          },
        ]
      : [],
    pages,
  };
}

// "budget_estimate" chat turn — sums each item's cheapest current listing
// (the best-price-per-item "split across stores" total) and, separately,
// checks whether any single store carries every item, for a one-stop total.
// Every dollar figure comes straight from the matched listings.
function runBudgetEstimate(agent, baseUrl) {
  const lines = agent.items.map(item => {
    // department is deliberately never passed through here — same reason
    // as runStoreCompare: each list entry is one specific item, and a
    // department match would price the CHEAPEST THING IN THAT AISLE
    // instead, e.g. "ground beef" silently pricing out as pork chops.
    const {products, pages, terms} = searchProductsExpanded(item.terms, baseUrl, {
      limit: 50,
      must: item.must,
      broad: item.scope === 'broad',
      includeExpired: false,
      stores: agent.stores,
    });
    const label = item.intent || item.department || terms[0] || 'item';
    const priced = products.filter(p => Number.isFinite(p.priceValue));

    const byStore = new Map();
    for (const p of priced) {
      const cur = byStore.get(p.store);
      if (!cur || p.priceValue < cur.priceValue) {
        byStore.set(p.store, p);
      }
    }
    const cheapest = priced.length
      ? priced.reduce((a, b) => (b.priceValue < a.priceValue ? b : a))
      : null;

    return {label, cheapest, byStore, products: priced, pages};
  });

  const found = lines.filter(l => l.cheapest);
  const missing = lines.filter(l => !l.cheapest).map(l => l.label);
  const fmt = v => `$${v.toFixed(2)}`;

  let reply;
  if (!found.length) {
    reply = "I couldn't find current prices for any of those items.";
  } else {
    const splitTotal = found.reduce((sum, l) => sum + l.cheapest.priceValue, 0);
    const itemList = found.map(l => l.label).join(', ');

    // A store only counts toward a one-stop total if it carries EVERY
    // found item — otherwise the trip wouldn't actually cover the list.
    const allStores = new Set();
    for (const l of found) {
      for (const store of l.byStore.keys()) {
        allStores.add(store);
      }
    }
    const storeTotals = [...allStores]
      .map(store => {
        let total = 0;
        for (const l of found) {
          const p = l.byStore.get(store);
          if (!p) {
            return null;
          }
          total += p.priceValue;
        }
        return {store, total};
      })
      .filter(Boolean)
      .sort((a, b) => a.total - b.total);

    const storeNote = storeTotals.length
      ? ` Shopping one store: ${storeTotals[0].store} has everything for ` +
        `${fmt(storeTotals[0].total)}` +
        (storeTotals.length > 1
          ? `, vs ${storeTotals
              .slice(1)
              .map(s => `${fmt(s.total)} at ${s.store}`)
              .join(', ')}.`
          : '.')
      : ' No single store currently carries all of these.';
    const missingNote = missing.length
      ? ` (Couldn't find current prices for: ${missing.join(', ')}.)`
      : '';

    reply =
      `Splitting across stores for the best price on each item: ${fmt(splitTotal)} ` +
      `(${itemList}).${storeNote}${missingNote}`;
  }

  return {
    reply,
    groups: found.map(l => ({
      label: l.label,
      products: l.products.slice(0, 6),
      terms: [],
      must: [],
      total: l.products.length,
    })),
    pages: mergePages(found),
  };
}

// "2026-09-03" -> "Sep 3" — for naming the flyer week a price happened in.
function formatWeekOf(iso) {
  if (!iso) {
    return null;
  }
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
}

// Deterministic reply text for "list_alerts" — built straight from listAlerts()
// rows, same rule as everywhere else: real data in, never a Gemini guess.
function composeAlertsReply(alerts) {
  if (!alerts.length) {
    return "You don't have any price alerts set yet. Ask me to let you know " +
      'when something drops below a price, like "tell me when milk drops below $4".';
  }
  const cmp = a => (a.comparison === 'lt' ? 'under' : 'at or under');
  const open = alerts.filter(a => !a.resolvedAt);
  const resolved = alerts.filter(a => a.resolvedAt);

  const parts = [];
  if (open.length) {
    const list = open
      .map(a => `${a.canonicalName} ${cmp(a)} $${a.targetPrice.toFixed(2)}`)
      .join('; ');
    parts.push(`Watching ${open.length} item${open.length === 1 ? '' : 's'}: ${list}.`);
  }
  if (resolved.length) {
    const list = resolved
      .slice(0, 3)
      .map(a => `${a.canonicalName} (target was $${a.targetPrice.toFixed(2)})`)
      .join('; ');
    parts.push(
      `Already matched: ${list}${resolved.length > 3 ? `, +${resolved.length - 3} more` : ''}.`,
    );
  }
  return parts.join(' ');
}

// Deterministic reply text for a "price_insight" chat turn — every number in
// here comes straight from priceInsight()'s SQL aggregates, never from Gemini,
// so the agent can never state a price or trend it made up.
function composePriceInsightReply(agent, insight) {
  const {productHint, insightType, targetPrice} = agent;
  const fmt = v => (v == null ? null : `$${v.toFixed(2)}`);
  const min90dWeek = formatWeekOf(insight.min90dValidFrom);
  // A single sighting is only ever today's own price — nothing to compare it
  // against, so never claim a deal quality / "lowest in N months" from it.
  const notEnoughHistory = insight.sightings < 2;
  // Some flyer prices are per lb/kg, others flat per item, others a
  // multi-buy count ("2/$7") — priceValue is just a plain number regardless,
  // so a "trend" across mixed bases can look like a real swing when it's
  // really just a different way of pricing the same product. Only appended
  // to an actual numeric answer, never to a "not enough history yet" one.
  const unitCaveat = insight.mixedPriceUnits
    ? " Heads up: these flyer prices aren't all priced the same way (some per lb/kg, others per item or a multi-buy), so the comparison may not be exact."
    : '';

  if (targetPrice) {
    if (notEnoughHistory) {
      return `I don't have enough price history on ${productHint} yet to judge $${targetPrice.toFixed(2)}.`;
    }
    if (targetPrice <= insight.min90d * 1.05) {
      return `$${targetPrice.toFixed(2)} is a great price for ${productHint} — that matches its lowest price in the last 90 days (${fmt(insight.min90d)}).${unitCaveat}`;
    }
    if (targetPrice <= insight.median90d) {
      return `$${targetPrice.toFixed(2)} is a good price for ${productHint} — below its typical price of ${fmt(insight.median90d)} (lowest recently: ${fmt(insight.min90d)}).${unitCaveat}`;
    }
    return `$${targetPrice.toFixed(2)} isn't a great deal on ${productHint} — it's been as low as ${fmt(insight.min90d)}, typically around ${fmt(insight.median90d)}.${unitCaveat}`;
  }

  switch (insightType) {
    case 'lowest_price':
      if (notEnoughHistory) {
        return `I've only seen ${productHint} once so far — not enough history yet to say.`;
      }
      return (
        (insight.isLowestIn3Months
          ? `Yes — ${fmt(insight.currentPrice)} is the lowest ${productHint} has been in at least 3 months.`
          : `Not quite — ${productHint} is ${fmt(insight.currentPrice)} now; its lowest in the last 3 months was ${fmt(insight.min90d)}` +
              (min90dWeek ? `, the week of ${min90dWeek}` : '') +
              '.') + unitCaveat
      );
    case 'when_lowest': {
      if (notEnoughHistory || !min90dWeek) {
        return `I've only seen one price for ${productHint} so far (${fmt(insight.currentPrice)}) — not enough history to say when it was lowest.`;
      }
      const atStore = insight.min90dStore ? ` at ${insight.min90dStore}` : '';
      return `${fmt(insight.min90d)}${atStore}, the week of ${min90dWeek} — that's the lowest ${productHint} has been recently.${unitCaveat}`;
    }
    case 'store_compare': {
      if (!insight.byStore.length) {
        return `I don't have store-by-store data on ${productHint} yet.`;
      }
      const cheapest = [...insight.byStore].sort(
        (a, b) => (a.latestPrice ?? Infinity) - (b.latestPrice ?? Infinity),
      )[0];
      return `${cheapest.store} usually has the best price on ${productHint}, most recently ${fmt(cheapest.latestPrice)}.${unitCaveat}`;
    }
    case 'sale_frequency':
      return insight.saleFrequencyDays
        ? `${productHint} tends to go on sale about every ${insight.saleFrequencyDays} days.`
        : `I don't have enough sale history on ${productHint} yet to tell.`;
    case 'trend':
      return (
        `${productHint} is ${fmt(insight.currentPrice)} now; it's ranged from ${fmt(insight.min90d)}` +
        (min90dWeek ? ` (the week of ${min90dWeek})` : '') +
        ` to around ${fmt(insight.median90d)} in the last 90 days.${unitCaveat}`
      );
    case 'deal_quality':
    default:
      return insight.dealQuality
        ? `${productHint} at ${fmt(insight.currentPrice)} looks like a ${insight.dealQuality} deal (recent low: ${fmt(insight.min90d)}, typical: ${fmt(insight.median90d)}).${unitCaveat}`
        : `I don't have enough price history on ${productHint} yet to judge.`;
  }
}

/**
 * POST /chat  { messages: [{ role: 'user'|'assistant', content }] }
 *   -> { reply, groups: [{label, products, terms, must, total}], pages: [...] }
 *
 * The Chat-tab agent. One Gemini call turns the latest user turn into a
 * search (one group per distinct product asked about — "tomatoes and
 * chips" is two groups), a same-item store comparison, a multi-item budget
 * estimate, a price question, a new price alert, or a short reply. Turns
 * with no products to show return `groups: []`.
 */
app.post('/chat', express.json({limit: '32kb'}), async (req, res) => {
  try {
    const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .filter(
        m =>
          (m?.role === 'user' || m?.role === 'assistant') &&
          typeof m?.content === 'string',
      )
      .slice(-8)
      .map(m => ({role: m.role, content: m.content.slice(0, 2000)}));

    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({error: 'messages must end with a user turn'});
    }

    // A blank/whitespace-only turn has nothing for Gemini to classify — asking
    // anyway just invites it to guess. Answer locally instead.
    if (!messages[messages.length - 1].content.trim()) {
      return res.json({
        reply: "I didn't catch that — what product are you looking for, or what would you like to know?",
        groups: [],
        pages: [],
      });
    }

    const agent = await chatAgent(messages);

    if (agent.kind === 'search') {
      const baseUrl = baseUrlOf(req);
      // Multiple distinct products share the 24-item budget so a "tomatoes
      // and chips" ask doesn't return 24 of each.
      const limit =
        agent.groups.length > 1 ? Math.max(6, Math.floor(24 / agent.groups.length)) : 24;
      const results = agent.groups.map(g =>
        runSearchGroup(g, baseUrl, agent.includeExpired, limit),
      );

      return res.json({
        reply: results.map(r => r.reply).join('\n\n'),
        groups: results.map(({label, products, terms, must, total}) => ({
          label,
          products,
          terms,
          must,
          total,
        })),
        pages: mergePages(results),
      });
    }

    if (agent.kind === 'compare_stores') {
      const baseUrl = baseUrlOf(req);
      const {reply, groups, pages} = runStoreCompare(agent, baseUrl);
      return res.json({reply, groups, pages});
    }

    if (agent.kind === 'budget_estimate') {
      const baseUrl = baseUrlOf(req);
      const {reply, groups, pages} = runBudgetEstimate(agent, baseUrl);
      return res.json({reply, groups, pages});
    }

    if (agent.kind === 'price_insight') {
      // "tomatoes" pools every variety (field/grape/roma/...) into one
      // answer; only an explicit "products WITH tomatoes" ask (scope
      // "broad") also pulls in something that merely lists it as an
      // ingredient, e.g. a pasta sauce.
      const canonicalIds = resolveCanonicalIds(agent.productHint, {
        broad: agent.scope === 'broad',
      });
      const insight = canonicalIds.length ? priceInsight(canonicalIds) : null;
      const reply = insight
        ? composePriceInsightReply(agent, insight)
        : `I don't have enough price history for "${agent.productHint}" yet — it needs to show up in a couple of flyers first.`;
      return res.json({
        reply,
        groups: [],
        pages: [],
        priceInsight: insight,
      });
    }

    if (agent.kind === 'set_alert') {
      const canonicalId = resolveCanonicalId(agent.productHint);
      if (!canonicalId) {
        return res.json({
          reply: `I don't recognize "${agent.productHint}" yet — try again once it's shown up in a flyer.`,
          groups: [],
          pages: [],
        });
      }
      const userId = userIdOf(req);
      if (!userId) {
        return res.json({
          reply: `I couldn't set that alert — missing device id.`,
          groups: [],
          pages: [],
        });
      }
      getOrCreateUser(userId);
      createAlert({
        userId,
        canonicalProductId: canonicalId,
        targetPrice: agent.targetPrice,
        comparison: agent.comparison,
      });
      const cmp = agent.comparison === 'lt' ? 'under' : 'at or under';
      return res.json({
        reply: `Got it — I'll let you know when ${agent.productHint} drops ${cmp} $${agent.targetPrice.toFixed(2)}.`,
        groups: [],
        pages: [],
      });
    }

    if (agent.kind === 'list_alerts') {
      const userId = userIdOf(req);
      const alerts = userId ? listAlerts(userId) : [];
      return res.json({
        reply: userId
          ? composeAlertsReply(alerts)
          : "I couldn't check your alerts — missing device id.",
        groups: [],
        pages: [],
        alerts,
      });
    }

    if (agent.kind === 'cancel_alert') {
      const userId = userIdOf(req);
      if (!userId) {
        return res.json({
          reply: "I couldn't cancel that — missing device id.",
          groups: [],
          pages: [],
        });
      }
      // No product named -> cancel everything open; named but unrecognized ->
      // nothing to cancel (never claim success for a product we can't match).
      const canonicalId = agent.productHint
        ? resolveCanonicalId(agent.productHint)
        : null;
      const count =
        agent.productHint && !canonicalId
          ? 0
          : cancelAlerts({userId, canonicalProductId: canonicalId});
      const reply = !count
        ? agent.productHint
          ? `You don't have any open alerts for "${agent.productHint}".`
          : "You don't have any open alerts to cancel."
        : agent.productHint
        ? `Cancelled your alert for "${agent.productHint}".`
        : `Cancelled all ${count} of your open alerts.`;
      return res.json({reply, groups: [], pages: []});
    }

    return res.json({
      reply: agent.text,
      groups: [],
      pages: [],
    });
  } catch (err) {
    console.error('[chat] failed:', err);
    res.status(500).json({error: err?.message || 'Chat failed'});
  }
});

app.listen(PORT, () => {
  const lan = lanAddress();
  console.log(`flyer-mind-ai extract API → http://localhost:${PORT}`);
  if (lan) {
    console.log(`  on this network (for a phone): http://${lan}:${PORT}`);
    console.log(`  → set LAN_HOST to "${lan}" in src/config.ts`);
  }
  console.log(`  stored products: ${totalProducts()}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn(
      '  ⚠  GEMINI_API_KEY is not set — copy server/.env.example to server/.env',
    );
  } else if (process.env.GEMINI_API_KEY === 'MOCK') {
    console.log('  ℹ  GEMINI_API_KEY=MOCK — returning canned products');
  }
});
