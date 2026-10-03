/** An in-memory Store, for testing the protocol handler alone. */

import { createHash, randomUUID } from "node:crypto";

import { RequestError } from "../src/protocol/errors.ts";
import type { Store, UploadedPart } from "../src/protocol/store.ts";

const drain = async (body: ReadableStream<Uint8Array>): Promise<Uint8Array> => new Uint8Array(await new Response(body).arrayBuffer());
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

export interface MemoryStore extends Store {
  readonly objects: Map<string, Uint8Array>;
  readonly uploads: Map<string, Map<number, Uint8Array>>;
}

export function memoryStore(): MemoryStore {
  const objects = new Map<string, Uint8Array>();
  const uploads = new Map<string, Map<number, Uint8Array>>();
  const meta = (b: Uint8Array) => ({ size: b.length, etag: sha256(b).slice(0, 16) });
  return {
    objects,
    uploads,
    async head(key) {
      const b = objects.get(key);
      return b ? meta(b) : null;
    },
    async get(key) {
      const b = objects.get(key);
      return b ? { ...meta(b), body: new Response(b).body ?? new ReadableStream() } : null;
    },
    async put(key, body, size, opts) {
      const b = await drain(body);
      if (b.length !== size) throw new RequestError(400, "length mismatch");
      if (opts.sha256 !== undefined && sha256(b) !== opts.sha256) throw new RequestError(400, "sha256 mismatch");
      objects.set(key, b);
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix, cursor) {
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = Number(cursor ?? 0);
      const keys = all.slice(from, from + 2);
      return from + 2 < all.length ? { keys, cursor: String(from + 2) } : { keys };
    },
    async createMultipart() {
      const id = randomUUID();
      uploads.set(id, new Map());
      return id;
    },
    async uploadPart(_key, uploadId, partNumber, body): Promise<UploadedPart> {
      const parts = uploads.get(uploadId);
      if (!parts) throw new RequestError(404, "no upload");
      const b = await drain(body);
      parts.set(partNumber, b);
      return { partNumber, etag: meta(b).etag };
    },
    async completeMultipart(key, uploadId, parts) {
      const staged = uploads.get(uploadId);
      if (!staged) throw new RequestError(404, "no upload");
      const chunks = parts.map((p) => staged.get(p.partNumber) ?? new Uint8Array());
      objects.set(key, new Uint8Array(Buffer.concat(chunks)));
      uploads.delete(uploadId);
    },
    async abortMultipart(_key, uploadId) {
      uploads.delete(uploadId);
    },
    async sha256(key) {
      const b = objects.get(key);
      return b ? sha256(b) : null;
    },
  };
}
