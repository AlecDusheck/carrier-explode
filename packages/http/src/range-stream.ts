/** A large byte range as a stream that resumes where a connection broke; fetchRange buffers, which a 10 GB image cannot afford. */

import { fetchWithRetry, RangeResponseError, type RetryOptions } from "./fetch.ts";

/** Broken bodies in a row before giving up; any progress resets the count. */
const TRIES = 6;
const BACKOFF_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exactly bytes `start .. start + length - 1` of `url`, in order. `opts` also applies to each request. */
export async function* streamRange(url: string, start: number, length: number, opts: RetryOptions = {}): AsyncGenerator<Uint8Array> {
  const tries = opts.tries ?? TRIES;
  const backoff = opts.backoff ?? BACKOFF_MS;
  const end = start + length - 1;
  let at = start;
  let failures = 0;
  while (at <= end) {
    const res = await fetchWithRetry(url, { headers: { range: `bytes=${at}-${end}` } }, opts);
    const range = res.headers.get("content-range");
    if (res.status !== 206 || !range?.startsWith(`bytes ${at}-${end}/`) || !res.body) {
      await res.body?.cancel();
      throw new RangeResponseError(`asked ${url} for bytes ${at}-${end}, got HTTP ${res.status} ${range ?? "without Content-Range"}`);
    }
    let broke: unknown;
    try {
      for await (const chunk of res.body) {
        if (chunk.length === 0) continue;
        const take = Math.min(chunk.length, end - at + 1);
        yield take === chunk.length ? chunk : chunk.subarray(0, take);
        at += take;
        failures = 0;
        if (at > end) break;
      }
    } catch (e) {
      broke = e;
    }
    if (at > end) return;
    if (++failures >= tries) throw broke ?? new RangeResponseError(`${url}: body ended at ${at}, ${end - at + 1} bytes short`);
    await sleep(backoff * 2 ** (failures - 1));
  }
}
