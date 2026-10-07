/** fetch with one retry policy and verified Range reads. No format knowledge, no host lists. */

/** A response that settles the request: a status not worth retrying, or the last attempt's. */
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
	/** Attempts in all (default 5). Every method is retried, so a non-idempotent request must be safe to repeat. */
	readonly tries?: number;
	/** First backoff in ms, doubled per attempt, with ±50% jitter (default 1000). */
	readonly backoff?: number;
	/** ms one attempt may take before it is abandoned and retried (default: no limit). */
	readonly timeout?: number;
	/** Injected fetch, for tests and for callers that wrap it. */
	readonly fetch?: typeof fetch;
}

const USER_AGENT = "carrier-explode";
const DEFAULT_TRIES = 5;
const DEFAULT_BACKOFF_MS = 1000;
/** A Retry-After longer than this is not waited out: the attempt budget ends sooner. */
const MAX_RETRY_AFTER_MS = 60_000;

const retryable = (status: number): boolean => status === 429 || status >= 500;

function sleep(ms: number, signal: AbortSignal | null): Promise<void> {
	return new Promise((resolve, reject) => {
		const done = (): void => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", done);
			resolve();
		}, ms);
		signal?.addEventListener("abort", done, { once: true });
	});
}

/** Exponential backoff with jitter; a server's Retry-After (in seconds) wins when it asks for longer. */
function backoffMs(attempt: number, base: number, res?: Response): number {
	const jittered = base * 2 ** (attempt - 1) * (0.5 + Math.random());
	const after = Number(res?.headers.get("retry-after") ?? NaN) * 1000;
	return Number.isFinite(after) && after > jittered ? Math.min(after, MAX_RETRY_AFTER_MS) : jittered;
}

/** The caller's signal, plus the attempt's own timeout; `clear` stops the timer once the attempt is done. */
function attemptSignal(
	caller: AbortSignal | null,
	timeout: number | undefined,
): { readonly signal: AbortSignal | null; clear(): void } {
	if (timeout === undefined) return { signal: caller, clear: () => {} };
	const own = new AbortController();
	const timer = setTimeout(
		() => own.abort(new DOMException(`no answer within ${timeout} ms`, "TimeoutError")),
		timeout,
	);
	return {
		signal: caller ? AbortSignal.any([caller, own.signal]) : own.signal,
		clear: () => clearTimeout(timer),
	};
}

/**
 * Fetches, then `use`s an ok response, retrying 429, 5xx, network errors and timeouts as one budget.
 * `use` failing with a network error (a body cut short) is retried too; its HttpError or RangeResponseError is final.
 */
async function retrying<T>(
	url: string | URL,
	init: RequestInit,
	opts: RetryOptions,
	use: (res: Response) => Promise<T>,
): Promise<T> {
	const { tries = DEFAULT_TRIES, backoff = DEFAULT_BACKOFF_MS, timeout, fetch: doFetch = fetch } = opts;
	const headers = new Headers(init.headers);
	if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
	// On a URL new to it, Cloudflare's subrequest cache drops a Range and answers 200 with the whole file.
	const cache = headers.has("range") ? ({ cache: "no-store" } as const) : {};
	const caller = init.signal ?? null;
	for (let attempt = 1; ; attempt++) {
		caller?.throwIfAborted();
		const { signal, clear } = attemptSignal(caller, timeout);
		let wait: number;
		try {
			const res = await doFetch(url, { ...init, headers, signal, ...cache });
			if (res.ok) return await use(res);
			// The body of a failed attempt is never read; cancelling it frees the connection.
			await res.body?.cancel();
			if (attempt >= tries || !retryable(res.status)) throw new HttpError(String(url), res.status);
			wait = backoffMs(attempt, backoff, res);
		} catch (e) {
			if (e instanceof HttpError || e instanceof RangeResponseError || caller?.aborted || attempt >= tries)
				throw e;
			wait = backoffMs(attempt, backoff);
		} finally {
			clear();
		}
		await sleep(wait, caller);
	}
}

/** Resolves only with an ok response; see RetryOptions for what is retried. */
export function fetchWithRetry(
	url: string | URL,
	init: RequestInit = {},
	opts: RetryOptions = {},
): Promise<Response> {
	return retrying(url, init, opts, async (res) => res);
}

/** `bytes a-b/total` -> the range it holds. */
function contentRange(header: string | null): { readonly start: number; readonly end: number } | undefined {
	const [, start, end] = header?.match(/^bytes (\d+)-(\d+)\/(?:\d+|\*)$/) ?? [];
	return start === undefined || end === undefined ? undefined : { start: Number(start), end: Number(end) };
}

/** Bytes `start..end` inclusive. A server that ignores Range answers 200 with the whole file, so status, Content-Range and length are all checked. */
export async function fetchRange(
	url: string | URL,
	start: number,
	end: number,
	opts: RetryOptions = {},
): Promise<Uint8Array> {
	if (!(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start)) {
		throw new RangeError(`bad range ${start}-${end}`);
	}
	return retrying(url, { headers: { range: `bytes=${start}-${end}` } }, opts, async (res) => {
		const got = contentRange(res.headers.get("content-range"));
		if (res.status !== 206 || got?.start !== start || got.end !== end) {
			await res.body?.cancel();
			throw new RangeResponseError(
				`asked ${url} for bytes ${start}-${end}, got HTTP ${res.status} ${res.headers.get("content-range") ?? "without Content-Range"}`,
			);
		}
		const body = new Uint8Array(await res.arrayBuffer());
		if (body.length !== end - start + 1)
			throw new RangeResponseError(
				`asked ${url} for ${end - start + 1} bytes at ${start}, got ${body.length}`,
			);
		return body;
	});
}

/** The resource's size, from a HEAD request. */
export async function contentLength(url: string | URL, opts: RetryOptions = {}): Promise<number> {
	const head = await fetchWithRetry(url, { method: "HEAD" }, opts);
	const len = Number(head.headers.get("content-length") ?? NaN);
	if (!Number.isSafeInteger(len) || len < 0)
		throw new RangeResponseError(`HEAD ${url} gave no usable Content-Length`);
	return len;
}
