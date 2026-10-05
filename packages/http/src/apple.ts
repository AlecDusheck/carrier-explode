/** Downloads from Apple's hosts, the one place the allow-list lives. */

import { fetchWithRetry, type RetryOptions } from "./fetch.ts";

// updates.cdn-apple.com, appldnld.apple.com, and the 2008-era appldnld.apple.com.edgesuite.net
const APPLE_HOST = /(^|\.)(cdn-)?apple\.com(\.edgesuite\.net)?$/;

export const isAppleHost = (host: string): boolean => APPLE_HOST.test(host);

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

/** A file on Apple's hosts. Old URLs are http-only and some hosts dropped http, so the other scheme is tried after the first. */
export async function fetchApple(url: string | URL, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const first = new URL(url);
  if (!isAppleHost(first.hostname)) throw new TypeError(`${first.href}: not an Apple host`);
  const get = async (u: URL): Promise<Uint8Array<ArrayBuffer>> => new Uint8Array(await (await fetchWithRetry(u, init, opts)).arrayBuffer());
  try {
    return await get(first);
  } catch (e1) {
    if (isAbort(e1)) throw e1;
    const other = new URL(first);
    other.protocol = first.protocol === "https:" ? "http:" : "https:";
    try {
      return await get(other);
    } catch (e2) {
      throw new AggregateError([e1, e2], `${first.host}: failed over both http and https`);
    }
  }
}
