import { config } from '../config';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly headers: Headers,
    body: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}: ${body.slice(0, 200)}`);
  }
}

interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...opts.headers },
    body: opts.body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
  });
  if (!res.ok) throw new HttpError(res.status, url, res.headers, await res.text().catch(() => ''));
  return { data: (await res.json()) as T, headers: res.headers };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
