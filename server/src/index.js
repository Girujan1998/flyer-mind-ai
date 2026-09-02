import './loadEnv.js';
import './logger.js';

import {createHash} from 'node:crypto';
import {networkInterfaces} from 'node:os';

import cors from 'cors';
import express from 'express';
import multer from 'multer';

import {
  PAGES_DIR,
  THUMBS_DIR,
  departmentCounts,
  filterFacets,
  findFlyerByHash,
  productCountForFlyer,
  saveExtraction,
  searchProducts,
  totalProducts,
} from './db.js';
import {extractFlyer, extractFlyerMeta} from './gemini.js';
import {renderPdf} from './pdf.js';
import {renderThumbs} from './thumbs.js';

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
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 100;
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

// Extractions in progress, keyed by the PDF's sha256. If the phone locks and the
// app's upload connection dies mid-extraction, the app retries the same POST —
// this lets that retry attach to the running job instead of starting a second
// (wasted) Gemini pass. A finished flyer is deduped by findFlyerByHash instead.
const inFlight = new Map();

async function runExtraction({buffer, name, hash, rendered, maxPages}) {
  const t0 = Date.now();
  const [{products, usage}, metaResult] = await Promise.all([
    extractFlyer(rendered.pages.map(p => ({page: p.page, jpeg: p.jpegBase64}))),
    extractFlyerMeta(rendered.pages[0].jpegBase64).catch(err => {
      console.warn(`[gemini] flyer-meta failed: ${err.message}`);
      return null;
    }),
  ]);

  const meta = metaResult?.meta ?? null;
  if (metaResult) {
    const mu = metaResult.usage || {};
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
 * Renders + Gemini-extracts the flyer, SAVES products/pages/boxes to the DB,
 * and returns only a summary (the products live in the DB, seen via /products):
 *   { flyerId, name, savedProducts, renderedPages, totalPages, failedPages, reused }
 *
 * Re-posting the same PDF is safe: if it finished it returns the stored summary
 * (`reused: true`); if it's still running the request waits on that same job.
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
      return res.json({
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

      job = runExtraction({
        buffer: req.file.buffer,
        name,
        hash,
        rendered,
        maxPages,
      });
      inFlight.set(hash, job);
      const clear = () => inFlight.delete(hash);
      job.then(clear, clear);
    }

    const summary = await job;
    // The original request's socket may be dead (phone locked) while its retry
    // is the one still listening — only answer a live connection.
    if (!res.writableEnded) {
      res.json(summary);
    }
  } catch (err) {
    console.error('[extract] failed:', err);
    if (!res.writableEnded) {
      res.status(500).json({error: err?.message || 'Extraction failed'});
    }
  }
});

/**
 * GET /products?q=<text>&limit=20&offset=0
 *   -> { products: [{ id, flyerId, page, name, price, priceValue, info, box, confidence }],
 *        pages:    [{ flyerId, page, width, height, image }],   image = absolute URL
 *        total, hasMore }
 */
app.get('/products', (req, res) => {
  try {
    const result = searchProducts(
      {
        q: req.query.q,
        departments: req.query.department,
        stores: req.query.store,
        statuses: req.query.status,
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
        onSale: req.query.sale,
      }),
    );
  } catch (err) {
    console.error('[filters] failed:', err);
    res.status(500).json({error: err?.message || 'Query failed'});
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
