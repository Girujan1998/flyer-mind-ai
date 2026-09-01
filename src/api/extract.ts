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
  flyerId: string;
  page: number;
  name: string;
  /** Display price string, e.g. "34¢" or "$5.44". */
  price: string;
  /** Price as a number; null if unknown. */
  priceValue: number | null;
  /** Size / pack detail, e.g. "Each. Product of Canada." */
  info: string;
  box: GeminiBox | null;
  /** Model's 0-100 self-rated confidence; null if not reported. */
  confidence: number | null;
  /** URL of a small pre-cropped thumbnail of this product; null if none. */
  thumb: string | null;
};

export type FlyerPage = {
  flyerId: string;
  page: number;
  /** Pixel size of `image` — bounding boxes are placed against this. */
  width: number;
  height: number;
  /** Absolute URL of the rasterized page JPEG. */
  image: string;
};

/** Key a page (or a product's page) in a lookup map. */
export const pageKey = (flyerId: string, page: number) => `${flyerId}:${page}`;

export class NoServerError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new NoServerError(
      `Can't reach the extraction server at ${API_BASE_URL}. Is it running?`,
    );
  }
  const data = (await response.json().catch(() => null)) as
    | (T & {error?: string})
    | null;
  if (!response.ok || !data) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data;
}

export type UploadResult = {
  flyerId: string;
  name: string;
  savedProducts: number;
  renderedPages: number;
  totalPages: number;
  failedPages: number[];
  /** true when this exact PDF was already stored — not re-extracted. */
  reused: boolean;
};

/**
 * Upload a flyer PDF. The server rasterizes each page, runs Gemini vision, and
 * SAVES the products + bounding boxes to its database. Returns a summary only —
 * browse the products on the Search screen.
 */
export function extractFlyer(file: SelectedPdf): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name || 'flyer.pdf',
    type: file.mimeType || 'application/pdf',
  } as unknown as Blob);
  return api<UploadResult>('/flyers/extract', {method: 'POST', body: form});
}

export type SearchResult = {
  products: Product[];
  pages: FlyerPage[];
  total: number;
  hasMore: boolean;
};

/** Paginated + text search over every stored product, newest first. */
export function searchProducts(params: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<SearchResult> {
  // RN's URLSearchParams polyfill has no `.set()`, so build the string by hand.
  const qs = [
    `limit=${params.limit ?? 20}`,
    `offset=${params.offset ?? 0}`,
    params.q ? `q=${encodeURIComponent(params.q)}` : '',
  ]
    .filter(Boolean)
    .join('&');
  return api<SearchResult>(`/products?${qs}`);
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
