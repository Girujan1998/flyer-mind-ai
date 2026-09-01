import './loadEnv.js';

import {networkInterfaces} from 'node:os';

import cors from 'cors';
import express from 'express';
import multer from 'multer';

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

import {extractFlyer} from './gemini.js';
import {renderPdf} from './pdf.js';

const PORT = process.env.PORT || 3001;
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_UPLOAD_BYTES},
});

const app = express();
app.use(cors());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    gemini: process.env.GEMINI_API_KEY ? 'configured' : 'missing',
  });
});

/**
 * POST /flyers/extract   (multipart/form-data, field "file" = the flyer PDF)
 *
 * -> { pages:    [{ page, width, height, image }]   image = data:image/jpeg;base64,...
 *      products: [{ id, page, name, price, priceValue, info, box, confidence }]
 *                box = [ymin,xmin,ymax,xmax] 0-1000 · confidence = 0-100 (self-rated)
 *      usage:    {...}
 *      meta:     { totalPages, renderedPages } }
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

    console.log(
      `[extract] ${req.file.originalname} — ${rendered.renderedPages} page(s), ` +
        `${products.length} product(s), ${((Date.now() - t0) / 1000).toFixed(
          1,
        )}s`,
    );

    res.json({
      pages: rendered.pages.map(p => ({
        page: p.page,
        width: p.width,
        height: p.height,
        image: `data:image/jpeg;base64,${p.jpegBase64}`,
      })),
      products,
      usage,
      meta: {
        totalPages: rendered.totalPages,
        renderedPages: rendered.renderedPages,
      },
    });
  } catch (err) {
    console.error('[extract] failed:', err);
    res.status(500).json({error: err?.message || 'Extraction failed'});
  }
});

app.listen(PORT, () => {
  const lan = lanAddress();
  console.log(`flyer-mind-ai extract API → http://localhost:${PORT}`);
  if (lan) {
    console.log(`  on this network (for a phone): http://${lan}:${PORT}`);
    console.log(`  → set LAN_HOST to "${lan}" in src/config.ts`);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.warn(
      '  ⚠  GEMINI_API_KEY is not set — copy server/.env.example to server/.env',
    );
  } else if (process.env.GEMINI_API_KEY === 'MOCK') {
    console.log('  ℹ  GEMINI_API_KEY=MOCK — returning canned products');
  }
});
