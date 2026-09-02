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
  /** Brand-stripped generic type, e.g. "body spray deodorant"; '' if unknown. */
  category: string;
  /** Extra lowercase search terms (synonyms, aisle words); [] if none. */
  tags: string[];
  /** Coarse store aisle, e.g. "laundry", "fruit"; '' if unknown. */
  department: string;
  /** URL of a small pre-cropped thumbnail of this product; null if none. */
  thumb: string | null;
  /** Store this flyer is for, e.g. "Food Basics"; '' if unknown. */
  store: string;
  /** First day the flyer prices are in effect, "YYYY-MM-DD"; '' if unknown. */
  validFrom: string;
  /** Last day the flyer prices are in effect, "YYYY-MM-DD"; '' if unknown. */
  validTo: string;
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
  /** Store the flyer is for, e.g. "Food Basics"; '' if the model couldn't tell. */
  store: string;
  /** Price-validity window, "YYYY-MM-DD"; '' if not printed on page 1. */
  validFrom: string;
  validTo: string;
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

/** The filters currently applied on the Search screen. */
export type ProductFilters = {
  departments: string[];
  stores: string[];
  statuses: string[];
};

export const EMPTY_FILTERS: ProductFilters = {
  departments: [],
  stores: [],
  statuses: [],
};

export function countActiveFilters(f: ProductFilters): number {
  return f.departments.length + f.stores.length + f.statuses.length;
}

// RN's URLSearchParams polyfill has no `.set()`, so build the string by hand.
function filtersToQuery(f: ProductFilters): string[] {
  const csv = (key: string, vals: string[]) =>
    vals.length ? `${key}=${vals.map(encodeURIComponent).join(',')}` : '';
  return [
    csv('department', f.departments),
    csv('store', f.stores),
    csv('status', f.statuses),
  ];
}

/** Paginated + text search over every stored product, newest first. */
export function searchProducts(params: {
  q?: string;
  filters?: ProductFilters;
  limit?: number;
  offset?: number;
}): Promise<SearchResult> {
  const f = params.filters ?? EMPTY_FILTERS;
  const qs = [
    `limit=${params.limit ?? 20}`,
    `offset=${params.offset ?? 0}`,
    params.q ? `q=${encodeURIComponent(params.q)}` : '',
    ...filtersToQuery(f),
  ]
    .filter(Boolean)
    .join('&');
  return api<SearchResult>(`/products?${qs}`);
}

/** One selectable filter value and how many products carry it. */
export type Facet = {value: string; count: number};

export type FilterFacets = {
  departments: Facet[];
  stores: Facet[];
  statuses: Facet[];
  /** How many products the whole current selection returns. */
  total: number;
};

/**
 * Options for the filter modal. Counts are faceted against `applied` (and `q`):
 * each list reflects the other sections' picks, so an untouched section is never
 * a constraint and its own picks never zero its rows. Pass nothing for the
 * unfiltered totals.
 */
export function fetchFilterFacets(
  applied: ProductFilters = EMPTY_FILTERS,
  q = '',
): Promise<FilterFacets> {
  const qs = [q ? `q=${encodeURIComponent(q)}` : '', ...filtersToQuery(applied)]
    .filter(Boolean)
    .join('&');
  return api<FilterFacets>(`/filters${qs ? `?${qs}` : ''}`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as a local "YYYY-MM-DD" — comparable directly against flyer dates. */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Where today sits relative to a flyer's price window:
 * - `upcoming` — the start date is still in the future
 * - `valid`    — today is within [from, to] (both days included)
 * - `expired`  — today is past the end date
 * - `unknown`  — no usable dates on the flyer
 */
export type FlyerStatus = 'valid' | 'expired' | 'upcoming' | 'unknown';

export function flyerStatus(from: string, to: string): FlyerStatus {
  const hasFrom = ISO_DATE.test(from);
  const hasTo = ISO_DATE.test(to);
  if (!hasFrom && !hasTo) {
    return 'unknown';
  }
  const t = todayIso();
  if (hasFrom && from > t) {
    return 'upcoming';
  }
  if (hasTo && t > to) {
    return 'expired';
  }
  return 'valid';
}

/** True when today falls within [from, to], both days included. */
export function isFlyerValid(from: string, to: string): boolean {
  return flyerStatus(from, to) === 'valid';
}

/** "Sep 2" — short month + day, or '' if not a usable "YYYY-MM-DD". */
export function formatShortDate(iso: string): string {
  if (!ISO_DATE.test(iso)) {
    return '';
  }
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a flyer validity window for display, e.g. "Aug 27 – Sep 2, 2026".
 * Returns '' if neither date is a usable "YYYY-MM-DD".
 */
export function formatValidity(from: string, to: string): string {
  const a = ISO_DATE.test(from) ? new Date(`${from}T00:00:00`) : null;
  const b = ISO_DATE.test(to) ? new Date(`${to}T00:00:00`) : null;
  if (!a && !b) {
    return '';
  }
  const md = (d: Date) =>
    d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
  if (a && b) {
    return from === to
      ? `${md(a)}, ${a.getFullYear()}`
      : `${md(a)} – ${md(b)}, ${b.getFullYear()}`;
  }
  const one = (a ?? b) as Date;
  return `${md(one)}, ${one.getFullYear()}`;
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
