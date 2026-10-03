/**
 * A large byte range of a remote file as a stream of chunks, resumed from
 * where it broke when a connection drops. fetchRange (src/lib/http) buffers a
 * whole range, which is right for zip directories and manifests but not for a
 * 9 GB filesystem image or a 200 MB modem package.
 */

import { fetchWithRetry, RangeResponseError } from "../../../../../src/lib/http/index.ts";

/** Consecutive mid-body failures tolerated before giving up; progress resets the count. */
const TRIES = 6;
const BACKOFF_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Bytes `start .. start + length - 1` of `url`, in order, exactly `length` of them. */
export async function* streamRange(url: string, start: number, length: number): AsyncGenerator<Uint8Array> {
  const end = start + length - 1;
  let at = start;
  let failures = 0;
  while (at <= end) {
    const res = await fetchWithRetry(url, { headers: { range: `bytes=${at}-${end}` } });
    const range = res.headers.get("content-range") ?? "";
    if (res.status !== 206 || !range.startsWith(`bytes ${at}-${end}/`) || !res.body) {
      await res.body?.cancel();
      throw new RangeResponseError(`asked ${url} for bytes ${at}-${end}, got HTTP ${res.status} ${range || "without Content-Range"}`);
    }
    // A dropped connection, or a body that ends early, resumes from `at`; progress resets the count.
    let broke: unknown;
    try {
      for await (const chunk of res.body) {
        const take = Math.min(chunk.length, end - at + 1);
        if (take <= 0) break;
        yield take === chunk.length ? chunk : chunk.subarray(0, take);
        at += take;
        failures = 0;
      }
    } catch (e) {
      broke = e;
    }
    if (at > end) return;
    if (++failures >= TRIES) throw broke ?? new RangeResponseError(`${url}: body ended at ${at}, ${end - at + 1} bytes short`);
    await sleep(BACKOFF_MS * 2 ** (failures - 1));
  }
}
