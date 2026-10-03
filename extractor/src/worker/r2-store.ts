/** The Store port over the R2 binding. Streams throughout: the Worker never holds an object whole. */

import { bytesToHex } from "../../../src/lib/binary/index.ts";
import type { ListPage, Store, StoredObject, UploadedPart } from "../protocol/store.ts";

const LIST_PAGE = 1000;

const stored = (o: R2Object): StoredObject => ({ size: o.size, etag: o.etag });

/** R2 wants a stream of known length; FixedLengthStream gives it one and fails if the body runs short or long. */
const sized = (body: ReadableStream<Uint8Array>, size: number): ReadableStream<Uint8Array> =>
  body.pipeThrough(new FixedLengthStream(size));

export function r2Store(bucket: R2Bucket): Store {
  return {
    async head(key) {
      const o = await bucket.head(key);
      return o ? stored(o) : null;
    },
    async get(key) {
      const o = await bucket.get(key);
      return o ? { ...stored(o), body: o.body } : null;
    },
    async put(key, body, size, opts) {
      await bucket.put(key, sized(body, size), {
        ...(opts.sha256 ? { sha256: opts.sha256 } : {}),
        ...(opts.contentType ? { httpMetadata: { contentType: opts.contentType } } : {}),
      });
    },
    async delete(key) {
      await bucket.delete(key);
    },
    async list(prefix, cursor): Promise<ListPage> {
      const page = await bucket.list({ prefix, limit: LIST_PAGE, ...(cursor ? { cursor } : {}) });
      const keys = page.objects.map((o) => o.key);
      return page.truncated ? { keys, cursor: page.cursor } : { keys };
    },
    async createMultipart(key, contentType) {
      const upload = await bucket.createMultipartUpload(key, contentType ? { httpMetadata: { contentType } } : {});
      return upload.uploadId;
    },
    async uploadPart(key, uploadId, partNumber, body, size): Promise<UploadedPart> {
      const part = await bucket.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, sized(body, size));
      return { partNumber: part.partNumber, etag: part.etag };
    },
    async completeMultipart(key, uploadId, parts) {
      await bucket.resumeMultipartUpload(key, uploadId).complete([...parts]);
    },
    async abortMultipart(key, uploadId) {
      await bucket.resumeMultipartUpload(key, uploadId).abort();
    },
    async sha256(key) {
      const o = await bucket.get(key);
      if (!o) return null;
      const digest = new crypto.DigestStream("SHA-256");
      await o.body.pipeTo(digest);
      return bytesToHex(new Uint8Array(await digest.digest));
    },
  };
}
