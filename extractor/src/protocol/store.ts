/**
 * The storage port the r2.internal protocol is written against. The Worker
 * backs it with the R2 binding (../worker/r2-store.ts); the dev harness with a
 * directory (../../dev/dir-store.ts). One protocol implementation, three homes.
 */

export interface StoredObject {
  readonly size: number;
  readonly etag: string;
}

export interface ListPage {
  readonly keys: readonly string[];
  /** Present while there are more pages. */
  readonly cursor?: string;
}

export interface UploadedPart {
  readonly partNumber: number;
  readonly etag: string;
}

export interface Store {
  head(key: string): Promise<StoredObject | null>;
  get(key: string): Promise<(StoredObject & { readonly body: ReadableStream<Uint8Array> }) | null>;
  /**
   * Writes `size` bytes. With `sha256`, the store rejects bytes that do not
   * hash to it (R2 checks server-side), so a corrupt upload never lands.
   */
  put(key: string, body: ReadableStream<Uint8Array>, size: number, opts: { readonly sha256?: string; readonly contentType?: string }): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string, cursor?: string): Promise<ListPage>;
  createMultipart(key: string, contentType?: string): Promise<string>;
  uploadPart(key: string, uploadId: string, partNumber: number, body: ReadableStream<Uint8Array>, size: number): Promise<UploadedPart>;
  completeMultipart(key: string, uploadId: string, parts: readonly UploadedPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** sha256 of a stored object, streamed: how multipart uploads are verified, as R2 checks no digest for them. */
  sha256(key: string): Promise<string | null>;
}
