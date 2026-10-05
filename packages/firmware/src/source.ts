/** Random-access byte sources: a remote file over Range requests, a buffer, or a window of either. */

import { contentLength, fetchRange, type RetryOptions } from "@carrier-explode/http";

export interface RangeSource {
  /** For error messages: a URL or a description. */
  readonly label: string;
  readonly size: number;
  /** Exactly `length` bytes at `offset`; a SourceRangeError past the end. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** What a source has cost so far, for reporting and budgets. */
export interface FetchStats {
  readonly requests: number;
  readonly bytes: number;
}

export class SourceRangeError extends RangeError {
  override name = "SourceRangeError";
  readonly label: string;
  readonly offset: number;
  readonly length: number;
  readonly size: number;
  constructor(src: RangeSource, offset: number, length: number) {
    super(`${src.label}: read of ${length} at ${offset} is outside its ${src.size} bytes`);
    this.label = src.label;
    this.offset = offset;
    this.length = length;
    this.size = src.size;
  }
}

export function checkRange(src: RangeSource, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > src.size) {
    throw new SourceRangeError(src, offset, length);
  }
}

/** Reads here are manifests and single op blobs: a minute without one completing means a stalled connection. */
const RANGE_TIMEOUT_MS = 60_000;

/** A remote file read by HTTP Range requests, counting what it fetches. */
export class HttpSource implements RangeSource {
  readonly label: string;
  readonly size: number;
  private readonly retry: RetryOptions;
  private requests = 0;
  private bytes = 0;

  private constructor(url: string, size: number, retry: RetryOptions) {
    this.label = url;
    this.size = size;
    this.retry = retry;
  }

  static async open(url: string, retry: RetryOptions = {}): Promise<HttpSource> {
    const opts = { timeout: RANGE_TIMEOUT_MS, ...retry };
    return new HttpSource(url, await contentLength(url, opts), opts);
  }

  get stats(): FetchStats {
    return { requests: this.requests, bytes: this.bytes };
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    checkRange(this, offset, length);
    if (length === 0) return new Uint8Array();
    const got = await fetchRange(this.label, offset, offset + length - 1, this.retry);
    this.requests++;
    this.bytes += got.length;
    return got;
  }
}

/** An in-memory buffer as a source (tests, or a file already read whole). */
export function bytesSource(bytes: Uint8Array, label = "buffer"): RangeSource {
  const src: RangeSource = {
    label,
    size: bytes.length,
    read: async (offset, length) => {
      checkRange(src, offset, length);
      return bytes.slice(offset, offset + length);
    },
  };
  return src;
}

/** A window of another source: a zip member stored uncompressed, read in place. */
export function subSource(parent: RangeSource, offset: number, size: number, label: string): RangeSource {
  checkRange(parent, offset, size);
  const src: RangeSource = {
    label,
    size,
    read: async (o, length) => {
      checkRange(src, o, length);
      return parent.read(offset + o, length);
    },
  };
  return src;
}
