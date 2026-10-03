/** Random-access byte sources: a remote file over Range requests, or a buffer. */

import { contentLength, fetchRange, type RetryOptions } from "../http/index.ts";

export interface RangeSource {
  /** For error messages: a URL or a description. */
  readonly label: string;
  readonly size: number;
  /** Exactly `length` bytes at `offset`; throws past the end. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** What a source has cost so far, for reporting and budgets. */
export interface FetchStats {
  readonly requests: number;
  readonly bytes: number;
}

export class SourceRangeError extends RangeError {
  override name = "SourceRangeError";
}

function checkRange(src: RangeSource, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > src.size) {
    throw new SourceRangeError(`${src.label}: read of ${length} at ${offset} is outside its ${src.size} bytes`);
  }
}

/** A remote file read by HTTP Range requests, counting what it fetches. */
export class HttpSource implements RangeSource {
  readonly label: string;
  readonly size: number;
  private readonly retry: RetryOptions;
  private requestCount = 0;
  private byteCount = 0;

  private constructor(url: string, size: number, retry: RetryOptions) {
    this.label = url;
    this.size = size;
    this.retry = retry;
  }

  static async open(url: string, retry: RetryOptions = {}): Promise<HttpSource> {
    return new HttpSource(url, await contentLength(url, retry), retry);
  }

  get stats(): FetchStats {
    return { requests: this.requestCount, bytes: this.byteCount };
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    checkRange(this, offset, length);
    if (length === 0) return new Uint8Array();
    this.requestCount++;
    this.byteCount += length;
    return fetchRange(this.label, offset, offset + length - 1, this.retry);
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
export function subSource(parent: RangeSource, offset: number, size: number, label = `${parent.label}@${offset}`): RangeSource {
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
