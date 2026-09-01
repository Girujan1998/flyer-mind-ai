import { Asset } from 'expo-asset';

import mockFlyerPage from '../../assets/mock-flyer-page.jpg';
import sampleFlyerPdf from '../../assets/sample-flyer.pdf';

import { env } from '@/config/env';

export type SelectedPdf = {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
};

/** Gemini box: `[ymin, xmin, ymax, xmax]`, normalized to 0–1000 of the page image. */
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
};

export type FlyerPage = {
  page: number;
  /** Pixel size of `image` — bounding boxes are placed against this. */
  width: number;
  height: number;
  /** Remote URL / data URI of the rasterized page (a bundled asset in mock mode). */
  image: string | number;
};

export type ExtractResult = {
  pages: FlyerPage[];
  products: Product[];
};

export type ExtractOptions = {
  /**
   * Skip the network and return canned data — mirrors the server's
   * `GEMINI_API_KEY=MOCK` path. Off by default; the "try a sample flyer" link
   * passes `true` so it works with no server running.
   */
  mock?: boolean;
};

/**
 * Upload a flyer PDF to the extraction API (`server/`), which rasterizes each
 * page and runs Gemini vision, and get back `{ pages, products }`.
 */
export async function extractFlyer(
  file: SelectedPdf,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  if (options.mock) {
    await new Promise((resolve) => setTimeout(resolve, 1400));
    return MOCK_RESULT;
  }

  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name || 'flyer.pdf',
    type: file.mimeType || 'application/pdf',
    // React Native's FormData accepts this file shape; the DOM lib types don't.
  } as unknown as Blob);

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}/flyers/extract`, { method: 'POST', body: form });
  } catch {
    throw new NoServerError(
      `Can't reach the extraction server at ${env.apiBaseUrl}. Is it running?`,
    );
  }

  const data = (await response.json().catch(() => null)) as
    | (ExtractResult & { error?: string })
    | null;

  if (!response.ok || !data) {
    throw new Error(data?.error || `Extraction failed (${response.status})`);
  }
  return { pages: data.pages, products: data.products };
}

export class NoServerError extends Error {}

/**
 * The bundled sample flyer (`assets/sample-flyer.pdf`) as an uploadable file —
 * backs the "try a sample flyer" link so it runs the real pipeline.
 */
export async function sampleFlyerFile(): Promise<SelectedPdf> {
  const asset = Asset.fromModule(sampleFlyerPdf);
  if (!asset.localUri) await asset.downloadAsync();
  return {
    uri: asset.localUri ?? asset.uri,
    name: 'Sample Walmart flyer.pdf',
    mimeType: 'application/pdf',
  };
}

/** Convert a Gemini box to a pixel rect on the page, padded and clamped. */
export function boxToRect(
  box: GeminiBox | null,
  pageWidth: number,
  pageHeight: number,
  padding = 0,
): { x: number; y: number; width: number; height: number } | null {
  if (!box || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box;
  const x0 = Math.max(0, (Math.min(xmin, xmax) / 1000) * pageWidth - padding);
  const y0 = Math.max(0, (Math.min(ymin, ymax) / 1000) * pageHeight - padding);
  const x1 = Math.min(pageWidth, (Math.max(xmin, xmax) / 1000) * pageWidth + padding);
  const y1 = Math.min(pageHeight, (Math.max(ymin, ymax) / 1000) * pageHeight + padding);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 1 || height <= 1) return null;
  return { x: x0, y: y0, width, height };
}

// --- Mock data: the sample Walmart flyer (assets/mock-flyer-page.jpg, 772×1000) ---

const MOCK_RESULT: ExtractResult = {
  pages: [{ page: 1, width: 1000, height: 1295, image: mockFlyerPage }],
  products: [
    {
      id: '1-corn',
      page: 1,
      name: 'Corn',
      price: '34¢',
      priceValue: 0.34,
      info: 'Each. Product of Canada. Canada No. 1.',
      box: [168, 52, 275, 182],
    },
    {
      id: '1-peaches',
      page: 1,
      name: 'Peaches 3 L or nectarines 2 L',
      price: '$5.44',
      priceValue: 5.44,
      info: 'Each. Product of Canada. Canada No. 1.',
      box: [168, 190, 275, 335],
    },
    {
      id: '1-blueberries',
      page: 1,
      name: 'Blueberries',
      price: '$3.44',
      priceValue: 3.44,
      info: 'Pack. Product of Canada. Canada No. 1.',
      box: [278, 52, 380, 182],
    },
    {
      id: '1-watermelon',
      page: 1,
      name: 'Large seedless watermelon',
      price: '$4.98',
      priceValue: 4.98,
      info: 'Each. Product of Canada or USA. Average 5 kg.',
      box: [278, 190, 380, 470],
    },
    {
      id: '1-chicken',
      page: 1,
      name: 'Maple Leaf fresh chicken leg quarters',
      price: '$3.17',
      priceValue: 3.17,
      info: '$6.98/kg.',
      box: [388, 52, 490, 180],
    },
    {
      id: '1-bacon',
      page: 1,
      name: 'Great Value bacon',
      price: '$3.97',
      priceValue: 3.97,
      info: 'Each. Selected varieties. 375 g.',
      box: [388, 188, 490, 325],
    },
    {
      id: '1-sausages',
      page: 1,
      name: 'Lafleur pork and beef sausages',
      price: '$8.98',
      priceValue: 8.98,
      info: 'Each. 1 kg. While quantities last.',
      box: [388, 333, 490, 470],
    },
    {
      id: '1-milk',
      page: 1,
      name: 'Sealtest 1% chocolate milk',
      price: '98¢',
      priceValue: 0.98,
      info: 'Each. 750 mL.',
      box: [536, 52, 630, 190],
    },
    {
      id: '1-silk',
      page: 1,
      name: 'Silk Almond, Cashew or Protein soy beverage',
      price: '$3.98',
      priceValue: 3.98,
      info: 'Each. Selected varieties. 1.75–1.89 L.',
      box: [536, 198, 630, 335],
    },
    {
      id: '1-cereal',
      page: 1,
      name: 'General Mills family size cereal',
      price: '$4.97',
      priceValue: 4.97,
      info: 'Each. Selected varieties and sizes.',
      box: [536, 343, 630, 475],
    },
    {
      id: '1-chips',
      page: 1,
      name: "Lay's chips",
      price: '$2.97',
      priceValue: 2.97,
      info: 'Each. Selected flavours. 220–235 g.',
      box: [752, 52, 845, 190],
    },
    {
      id: '1-gatorade',
      page: 1,
      name: 'Gatorade',
      price: '$6.27',
      priceValue: 6.27,
      info: 'Pack. Selected flavours. 6 x 591 mL.',
      box: [752, 198, 845, 335],
    },
  ],
};
