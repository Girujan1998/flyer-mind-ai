import { boxToRect, extractFlyer } from './extract';

import { cropLayout } from '@/components/CroppedFlyerImage';

describe('boxToRect', () => {
  it('maps a Gemini box (0–1000, [ymin,xmin,ymax,xmax]) to page pixels', () => {
    const rect = boxToRect([100, 200, 300, 600], 1000, 2000);
    expect(rect).toEqual({ x: 200, y: 200, width: 400, height: 400 });
  });

  it('normalizes reversed corners and clamps to the page', () => {
    const rect = boxToRect([300, 600, 100, 200], 500, 500, 50);
    expect(rect).toEqual({ x: 50, y: 0, width: 300, height: 200 });
  });

  it('returns null for a missing or degenerate box', () => {
    expect(boxToRect(null, 100, 100)).toBeNull();
    expect(boxToRect([500, 500, 500, 500], 100, 100)).toBeNull();
  });
});

describe('cropLayout', () => {
  const cover = (rect: { x: number; y: number; width: number; height: number }) =>
    cropLayout(772, 1000, rect, 173, 116);

  it('always covers the frame — no exposed edges — for a box near the right edge', () => {
    const { imageW, imageH, left, top } = cover({ x: 380, y: 162, width: 363, height: 144 });
    expect(left).toBeLessThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(0);
    expect(left + imageW).toBeGreaterThanOrEqual(173);
    expect(top + imageH).toBeGreaterThanOrEqual(116);
  });

  it('covers the frame for a box near the left edge', () => {
    const { imageW, imageH, left, top } = cover({ x: 35, y: 162, width: 328, height: 144 });
    expect(left).toBeLessThanOrEqual(0);
    expect(left + imageW).toBeGreaterThanOrEqual(173);
    expect(top + imageH).toBeGreaterThanOrEqual(116);
  });
});

describe('extractFlyer', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns canned pages + products in mock mode without hitting the network', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const result = await extractFlyer({ uri: '', name: 'sample.pdf' }, { mock: true });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.pages[0]).toMatchObject({ page: 1, width: expect.any(Number) });
    expect(result.products[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      priceValue: expect.any(Number),
      box: expect.any(Array),
    });
  });

  it('POSTs the PDF to the extraction API and returns its { pages, products }', async () => {
    const payload = { pages: [{ page: 1, width: 10, height: 20, image: 'data:,' }], products: [] };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }) as unknown as typeof fetch;

    const result = await extractFlyer({ uri: 'file:///f.pdf', name: 'f.pdf' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/flyers/extract'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual(payload);
  });

  it('surfaces the server error message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'The PDF has no renderable pages.' }),
    }) as unknown as typeof fetch;

    await expect(extractFlyer({ uri: 'file:///f.pdf', name: 'f.pdf' })).rejects.toThrow(
      'no renderable pages',
    );
  });
});
