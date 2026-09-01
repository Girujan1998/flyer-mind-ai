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
  findFlyerByHash,
  productCountForFlyer,
  saveExtraction,
  searchProducts,
  totalProducts,
} from './db.js';
import {extractFlyer} from './gemini.js';
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
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_UPLOAD_BYTES},
});

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

/**
 * POST /flyers/extract   (multipart/form-data, field "file" = the flyer PDF)
 *
 * Renders + Gemini-extracts the flyer, SAVES products/pages/boxes to the DB,
 * and returns only a summary (the products live in the DB, seen via /products):
 *   { flyerId, name, savedProducts, renderedPages, totalPages, failedPages, reused }
 *
 * If this exact PDF was uploaded before (same sha256), it is not re-extracted.
 */
app.post('/flyers/extract', upload.single('file'), async (req, res) => {
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

    const hash = createHash('sha256').update(req.file.buffer).digest('hex');
    const existing = findFlyerByHash(hash);
    if (existing) {
      console.log(`[extract] ${req.file.originalname} — already stored, skipping Gemini`);
      return res.json({
        flyerId: existing.id,
        name: existing.name,
        savedProducts: productCountForFlyer(existing.id),
        renderedPages: existing.rendered_pages,
        totalPages: existing.total_pages,
        failedPages: [],
        reused: true,
      });
    }

    const maxPages = req.query.maxpages
      ? Number(req.query.maxpages)
      : undefined;

    let rendered;
    try {
      rendered = renderPdf(req.file.buffer, {maxPages});
    } catch (err) {
      return res
        .status(422)
        .json({error: `Could not read the PDF: ${err.message}`});
    }
    if (!rendered.pages.length) {
      return res.status(422).json({error: 'The PDF has no renderable pages.'});
    }

    const t0 = Date.now();
    const {products, usage} = await extractFlyer(
      rendered.pages.map(p => ({page: p.page, jpeg: p.jpegBase64})),
    );

    let thumbs;
    try {
      thumbs = renderThumbs(req.file.buffer, products, {maxPages});
    } catch (err) {
      console.warn(`[thumbs] skipped: ${err.message}`);
    }

    const {flyerId, savedProducts} = saveExtraction({
      name: req.file.originalname || 'flyer.pdf',
      hash,
      totalPages: rendered.totalPages,
      renderedPages: rendered.renderedPages,
      pages: rendered.pages,
      products,
      thumbs,
    });

    console.log(
      `[extract] ${req.file.originalname} — ${rendered.renderedPages} page(s), ` +
        `${savedProducts} product(s) saved, ${((Date.now() - t0) / 1000).toFixed(
          1,
        )}s`,
    );

    res.json({
      flyerId,
      name: req.file.originalname || 'flyer.pdf',
      savedProducts,
      renderedPages: rendered.renderedPages,
      totalPages: rendered.totalPages,
      failedPages: usage.failedPages ?? [],
      reused: false,
    });
  } catch (err) {
    console.error('[extract] failed:', err);
    res.status(500).json({error: err?.message || 'Extraction failed'});
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
      {q: req.query.q, limit: req.query.limit, offset: req.query.offset},
      baseUrlOf(req),
    );
    res.json(result);
  } catch (err) {
    console.error('[products] failed:', err);
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
