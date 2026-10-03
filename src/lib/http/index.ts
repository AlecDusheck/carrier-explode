/**
 * fetch with shared retry policy, verified Range reads, and http/https fallback.
 * No format knowledge and no host allow-lists: callers keep those.
 */

/** A response that settles the request: 404, any other 4xx but 429, or the last failed attempt. */
export class HttpError extends Error {
  override name = "HttpError";
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`HTTP ${status} for ${url}`);
    this.url = url;
    this.status = status;
  }
}

/** A 2xx that is not the byte range that was asked for. */
export class RangeResponseError extends Error {
  override name = "RangeResponseError";
}

export interface RetryOptions {
  /** Attempts in all (default 5). */
  readonly tries?: number;
  /** First backoff in ms, doubled per attempt, with ±50% jitter (default 1000). */
  readonly backoff?: number;
  /** Injected fetch, for tests and for callers that wrap it. */
  readonly fetch?: typeof fetch;
}

const USER_AGENT = "carrier-explode";

/** Status codes worth another attempt: rate limits and server-side failures. */
const retryable = (status: number): boolean => status === 429 || status >= 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with jitter; a server's Retry-After (in seconds) wins when it asks for longer. */
function delay(attempt: number, base: number, res?: Response): number {
  const jittered = base * 2 ** attempt * (0.5 + Math.random());
  const after = Number(res?.headers.get("retry-after"));
  return Number.isFinite(after) && after * 1000 > jittered ? after * 1000 : jittered;
}

/** Retries 5xx, 429 and network errors with jittered backoff; resolves only with an ok response. */
export async function fetchWithRetry(url: string | URL, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Response> {
  const { tries = 5, backoff = 1000, fetch: doFetch = fetch } = opts;
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= tries - 1;
    let res: Response;
    try {
      res = await doFetch(url, { ...init, headers });
    } catch (e) {
      // An abort is the caller's decision, not a network failure.
      if (last || init.signal?.aborted) throw e;
      await sleep(delay(attempt, backoff));
      continue;
    }
    if (res.ok) return res;
    // Free the connection: the body of a failed attempt is never read.
    await res.body?.cancel();
    if (last || !retryable(res.status)) throw new HttpError(String(url), res.status);
    await sleep(delay(attempt, backoff, res));
  }
}

/** `bytes a-b/total` -> the range it holds. */
function parseContentRange(header: string | null): { start: number; end: number } | undefined {
  const m = header?.match(/^bytes (\d+)-(\d+)\/(?:\d+|\*)$/);
  if (!m?.[1] || !m[2]) return undefined;
  return { start: Number(m[1]), end: Number(m[2]) };
}

/** Bytes `start..end` inclusive. A server that ignores Range answers 200 with the whole file, so the 206, Content-Range and length are all checked. */
export async function fetchRange(url: string | URL, start: number, end: number, opts: RetryOptions & { readonly init?: RequestInit } = {}): Promise<Uint8Array> {
  if (!(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start)) {
    throw new RangeError(`bad range ${start}-${end}`);
  }
  const headers = new Headers(opts.init?.headers);
  headers.set("range", `bytes=${start}-${end}`);
  const { tries = 5, backoff = 1000 } = opts;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithRetry(url, { ...opts.init, headers }, opts);
    const got = parseContentRange(res.headers.get("content-range"));
    if (res.status !== 206 || !got || got.start !== start || got.end !== end) {
      await res.body?.cancel();
      throw new RangeResponseError(`asked ${url} for bytes ${start}-${end}, got HTTP ${res.status} ${res.headers.get("content-range") ?? "without Content-Range"}`);
    }
    let body: Uint8Array;
    try {
      body = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      // The connection dropped mid-body: fetchWithRetry only covers getting the headers.
      if (attempt >= tries - 1 || opts.init?.signal?.aborted) throw e;
      await sleep(delay(attempt, backoff));
      continue;
    }
    if (body.length !== end - start + 1) {
      throw new RangeResponseError(`asked ${url} for ${end - start + 1} bytes at ${start}, got ${body.length}`);
    }
    return body;
  }
}

/** The resource's size, from a HEAD request. */
export async function contentLength(url: string | URL, opts: RetryOptions = {}): Promise<number> {
  const head = await fetchWithRetry(url, { method: "HEAD" }, opts);
  const len = Number(head.headers.get("content-length") ?? NaN);
  if (!Number.isSafeInteger(len) || len < 0) throw new RangeResponseError(`HEAD ${url} gave no usable Content-Length`);
  return len;
}

/** Same URL with the other of http/https. */
function otherScheme(url: URL): URL {
  const alt = new URL(url);
  alt.protocol = url.protocol === "https:" ? "http:" : "https:";
  return alt;
}

/** Tries the URL, then its other scheme: old Apple URLs are http-only and some hosts have dropped http. */
export async function withSchemeFallback<T>(url: string | URL, attempt: (url: URL) => Promise<T>): Promise<T> {
  const first = new URL(url);
  if (first.protocol !== "http:" && first.protocol !== "https:") throw new TypeError(`not an http(s) URL: ${first}`);
  try {
    return await attempt(first);
  } catch (e1) {
    try {
      return await attempt(otherScheme(first));
    } catch (e2) {
      throw new AggregateError([e1, e2], `${first.host}: failed over both http and https`);
    }
  }
}
