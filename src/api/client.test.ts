import { ApiError, request } from './client';

describe('api client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('parses a JSON response body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ hello: 'world' }),
    }) as unknown as typeof fetch;

    await expect(request<{ hello: string }>('/thing')).resolves.toEqual({ hello: 'world' });
  });

  it('throws ApiError with status on non-2xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: 'nope' }),
    }) as unknown as typeof fetch;

    await expect(request('/missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
  });

  it('wraps network failures in ApiError with status 0', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('boom')) as unknown as typeof fetch;

    const error = await request('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });
});
