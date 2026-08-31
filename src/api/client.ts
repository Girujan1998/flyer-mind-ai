import { env } from '@/config/env';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type RequestOptions = Omit<RequestInit, 'body'> & {
  /** Parsed and JSON-stringified automatically. */
  body?: unknown;
  /** Query string params appended to the URL. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Abort the request after this many milliseconds. Defaults to 15000. */
  timeoutMs?: number;
};

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const url = new URL(path.replace(/^\//, ''), `${env.apiBaseUrl.replace(/\/$/, '')}/`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Thin typed wrapper around fetch. Centralizes base URL, JSON handling,
 * timeouts, and error normalization so screens/stores stay simple.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, params, timeoutMs = 15000, headers, ...rest } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(path, params), {
      ...rest,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    const parsed = text ? safeJsonParse(text) : undefined;

    if (!response.ok) {
      throw new ApiError(`Request to ${path} failed`, response.status, parsed ?? text);
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(`Request to ${path} timed out`, 408);
    }
    throw new ApiError(`Network error calling ${path}`, 0, error);
  } finally {
    clearTimeout(timeout);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
