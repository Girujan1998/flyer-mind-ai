import {API_BASE_URL} from '../config';

export type SelectedPdf = {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
};

/** Gemini box: `[ymin, xmin, ymax, xmax]`, normalized to 0-1000 of the page image. */
export type GeminiBox = [number, number, number, number];

export type Product = {
  id: string;
  page: number;
  name: string;
  /** Display price string, e.g. "34¢" or "$5.44". */
  price: string;
  /** Price as a number so a superscript "5⁴⁴" can't come back as 544; null if unknown. */
  priceValue: number | null;
  /** Size / pack detail, e.g. "Each. Product of Canada." */
  info: string;
  box: GeminiBox | null;
  /** Model's 0-100 self-rated confidence in name/price/box; null if not reported. */
  confidence: number | null;
};

export type FlyerPage = {
  page: number;
  /** Pixel size of `image` — bounding boxes are placed against this. */
  width: number;
  height: number;
  /** data:image/jpeg;base64,... of the rasterized page. */
  image: string;
};

export type ExtractResult = {
  pages: FlyerPage[];
  products: Product[];
  meta?: {totalPages: number; renderedPages: number; failedPages?: number[]};
};

export class NoServerError extends Error {}

/**
 * Upload a flyer PDF to the extraction API (`server/`), which rasterizes each
 * page and runs Gemini vision, and get back `{ pages, products }`.
 * Same pipeline as the flyer-ocr-extractor project.
 */
export async function extractFlyer(file: SelectedPdf): Promise<ExtractResult> {
  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name || 'flyer.pdf',
    type: file.mimeType || 'application/pdf',
  } as unknown as Blob);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/flyers/extract`, {
      method: 'POST',
      body: form,
    });
  } catch {
    throw new NoServerError(
      `Can't reach the extraction server at ${API_BASE_URL}. Is it running?`,
    );
  }

  const data = (await response.json().catch(() => null)) as
    | (ExtractResult & {error?: string})
    | null;

  if (!response.ok || !data) {
    throw new Error(data?.error || `Extraction failed (${response.status})`);
  }
  return {pages: data.pages, products: data.products, meta: data.meta};
}

/** Convert a Gemini box to a pixel rect on the page, padded and clamped. */
export function boxToRect(
  box: GeminiBox | null,
  pageWidth: number,
  pageHeight: number,
  padding = 0,
): {x: number; y: number; width: number; height: number} | null {
  if (!box || box.length !== 4) {
    return null;
  }
  const [ymin, xmin, ymax, xmax] = box;
  const x0 = Math.max(0, (Math.min(xmin, xmax) / 1000) * pageWidth - padding);
  const y0 = Math.max(0, (Math.min(ymin, ymax) / 1000) * pageHeight - padding);
  const x1 = Math.min(
    pageWidth,
    (Math.max(xmin, xmax) / 1000) * pageWidth + padding,
  );
  const y1 = Math.min(
    pageHeight,
    (Math.max(ymin, ymax) / 1000) * pageHeight + padding,
  );
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 1 || height <= 1) {
    return null;
  }
  return {x: x0, y: y0, width, height};
}
