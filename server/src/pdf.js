import * as mupdf from 'mupdf';

// Matches the browser renderer in repos/SandboxDemos/flyer-ocr-extractor
// (src/lib/pdf.js): cap the long edge at 1600 px, never upscale past 2x, JPEG.
const MAX_DIMENSION = 1600;
const MAX_SCALE = 2.0;
const JPEG_QUALITY = 82;

// Runaway guard for an absurdly long PDF; real flyers are far under it.
const DEFAULT_MAX_PAGES = 200;

/**
 * Rasterize a PDF buffer to per-page JPEGs.
 *
 * @param {Buffer|Uint8Array} buffer
 * @param {{ maxPages?: number }} [options]
 * @returns {{ pages: Array<{ page: number, width: number, height: number, jpegBase64: string }>,
 *            totalPages: number, renderedPages: number }}
 */
export function renderPdf(buffer, options = {}) {
  const maxPages = clampInt(options.maxPages, DEFAULT_MAX_PAGES, 1, 1000);
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const totalPages = doc.countPages();
    const renderedPages = Math.min(totalPages, maxPages);
    const pages = [];

    for (let i = 0; i < renderedPages; i++) {
      const page = doc.loadPage(i);
      const [x0, y0, x1, y1] = page.getBounds();
      const longEdge = Math.max(x1 - x0, y1 - y0);
      const scale = Math.min(MAX_SCALE, MAX_DIMENSION / longEdge);

      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );

      pages.push({
        page: i + 1,
        width: pixmap.getWidth(),
        height: pixmap.getHeight(),
        jpegBase64: Buffer.from(pixmap.asJPEG(JPEG_QUALITY, false)).toString(
          'base64',
        ),
      });

      pixmap.destroy();
      page.destroy();
    }

    return {pages, totalPages, renderedPages};
  } finally {
    doc.destroy();
  }
}

function clampInt(value, fallback, lo, hi) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) {
    return fallback;
  }
  return Math.max(lo, Math.min(hi, n));
}
