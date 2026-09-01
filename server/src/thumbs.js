import * as mupdf from 'mupdf';

// Per-product thumbnails, cropped from the flyer page with mupdf's pixmap warp.
// The app shows these on cards instead of loading + upscaling the whole page
// image per card, which was blowing up memory on a long product list.

const THUMB_MAX = 520; // px, long edge of a product thumbnail
const SRC_MAX = 1500; // px, long edge of the page we crop from
const PAD = 0.006; // fraction of the page, matches the app's boxToRect padding

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {Buffer|Uint8Array} pdfBuffer
 * @param {Array<{ page: number, box: number[]|null }>} products  (order preserved)
 * @param {{ maxPages?: number }} [opts]
 * @returns {Map<number, Buffer>}  product array index -> JPEG buffer
 */
export function renderThumbs(pdfBuffer, products, {maxPages} = {}) {
  const out = new Map();

  const byPage = new Map();
  products.forEach((p, index) => {
    if (Array.isArray(p.box) && p.box.length === 4) {
      const list = byPage.get(p.page) ?? [];
      list.push({index, box: p.box.map(Number)});
      byPage.set(p.page, list);
    }
  });
  if (!byPage.size) return out;

  const doc = mupdf.Document.openDocument(
    pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer),
    'application/pdf',
  );
  try {
    for (const [pageNum, list] of byPage) {
      if (maxPages && pageNum > maxPages) continue;
      let page;
      let px;
      try {
        page = doc.loadPage(pageNum - 1);
        const [bx0, by0, bx1, by1] = page.getBounds();
        const scale = Math.min(
          2.5,
          SRC_MAX / Math.max(bx1 - bx0, by1 - by0),
        );
        px = page.toPixmap(
          mupdf.Matrix.scale(scale, scale),
          mupdf.ColorSpace.DeviceRGB,
          false,
          true,
        );
        const W = px.getWidth();
        const H = px.getHeight();

        for (const {index, box} of list) {
          const [ymin, xmin, ymax, xmax] = box;
          const x0 = clamp((Math.min(xmin, xmax) / 1000 - PAD) * W, 0, W);
          const y0 = clamp((Math.min(ymin, ymax) / 1000 - PAD) * H, 0, H);
          const x1 = clamp((Math.max(xmin, xmax) / 1000 + PAD) * W, 0, W);
          const y1 = clamp((Math.max(ymin, ymax) / 1000 + PAD) * H, 0, H);
          const cw = x1 - x0;
          const ch = y1 - y0;
          if (cw < 8 || ch < 8) continue;

          const k = Math.min(1, THUMB_MAX / Math.max(cw, ch));
          const outW = Math.max(1, Math.round(cw * k));
          const outH = Math.max(1, Math.round(ch * k));
          try {
            const crop = px.warp(
              [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
              ],
              outW,
              outH,
            );
            out.set(index, Buffer.from(crop.asJPEG(78, false)));
            crop.destroy();
          } catch {
            /* skip one bad crop */
          }
        }
      } finally {
        px?.destroy();
        page?.destroy();
      }
    }
  } finally {
    doc.destroy();
  }

  return out;
}
