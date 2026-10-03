/**
 * R2Client over r2.internal (protocol: ../../../src/protocol/r2.ts). Every
 * request goes through the shared fetchWithRetry; bodies are always bytes in
 * memory, never streams, so a retry can resend them. Files are read a part at
 * a time, so memory stays at one part however large the file.
 */

import { open, stat } from "node:fs/promises";

import * as v from "valibot";

import { fetchWithRetry, HttpError, type RetryOptions } from "../../../../src/lib/http/index.ts";
import { keys } from "../../../../src/lib/storage/keys.ts";
import type { ObjMeta } from "../../../../src/lib/storage/keys.ts";
import { keyPath } from "../../../src/protocol/keys.ts";
import { MULTIPART_THRESHOLD, PART_SIZE } from "../../../src/protocol/limits.ts";
import type { PutBody, R2Client } from "../job.ts";
import { sha256Of } from "./digest.ts";

const listPageSchema = v.object({ keys: v.array(v.string()), cursor: v.exactOptional(v.string()) });
const createdSchema = v.union([
  v.object({ exists: v.literal(true) }),
  v.object({ exists: v.literal(false), uploadId: v.string() }),
]);
const partSchema = v.object({ partNumber: v.number(), etag: v.string() });

/** Where an upload's bytes come from: memory, or a file read part by part. */
type Source = { readonly size: number; read(offset: number, length: number): Promise<Uint8Array> };

function memorySource(bytes: Uint8Array): Source {
  return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
}

async function fileSource(path: string): Promise<Source> {
  const { size } = await stat(path);
  return {
    size,
    async read(offset, length) {
      const fh = await open(path, "r");
      try {
        const buf = new Uint8Array(length);
        const { bytesRead } = await fh.read(buf, 0, length, offset);
        if (bytesRead !== length) throw new Error(`${path}: read ${bytesRead} of ${length} bytes at ${offset}`);
        return buf;
      } finally {
        await fh.close();
      }
    },
  };
}

const sourceOf = (body: PutBody): Promise<Source> | Source =>
  typeof body === "string" ? memorySource(new TextEncoder().encode(body))
  : body instanceof Uint8Array ? memorySource(body)
  : fileSource(body.file);

/** null for a 404, the response otherwise; other failures throw (HttpError carries the status). */
async function maybe(url: string, init: RequestInit, retry: RetryOptions): Promise<Response | null> {
  try {
    return await fetchWithRetry(url, init, retry);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

export function createR2Client(base: string, retry: RetryOptions = {}): R2Client {
  const url = (path: string): string => new URL(path, base).toString();

  async function upload(key: string, body: PutBody, opts: { readonly contentType?: string; readonly sha256?: string }): Promise<void> {
    const src = await sourceOf(body);
    const headers: Record<string, string> = {
      ...(opts.contentType ? { "content-type": opts.contentType } : {}),
      ...(opts.sha256 ? { "x-sha256": opts.sha256 } : {}),
    };
    if (src.size <= MULTIPART_THRESHOLD) {
      await fetchWithRetry(url(keyPath("o", key)), { method: "PUT", headers, body: await src.read(0, src.size) }, retry);
      return;
    }
    const at = url(keyPath("mpu", key));
    const created = v.parse(createdSchema, await (await fetchWithRetry(at, { method: "POST", headers }, retry)).json());
    if (created.exists) return;
    const id = encodeURIComponent(created.uploadId);
    try {
      const parts = [];
      for (let n = 1, offset = 0; offset < src.size; n++, offset += PART_SIZE) {
        const chunk = await src.read(offset, Math.min(PART_SIZE, src.size - offset));
        const res = await fetchWithRetry(`${at}?uploadId=${id}&part=${n}`, { method: "PUT", body: chunk }, retry);
        parts.push(v.parse(partSchema, await res.json()));
      }
      await fetchWithRetry(`${at}?uploadId=${id}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parts }),
      }, retry);
    } catch (e) {
      // Leave no orphaned parts behind; the abort's own failure must not hide why the upload failed.
      await fetchWithRetry(`${at}?uploadId=${id}`, { method: "DELETE" }, retry).catch((abort: unknown) => {
        throw new AggregateError([e, abort], `${key}: multipart upload failed, and so did its abort`);
      });
      throw e;
    }
  }

  const client: R2Client = {
    async get(key) {
      const res = await maybe(url(keyPath("o", key)), {}, retry);
      return res ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async getJson(key) {
      const bytes = await client.get(key);
      return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
    },
    async head(key) {
      const res = await maybe(url(keyPath("o", key)), { method: "HEAD" }, retry);
      return res ? { size: Number(res.headers.get("content-length")) } : null;
    },
    async list(prefix) {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const q = new URLSearchParams({ prefix, ...(cursor ? { cursor } : {}) });
        const page = v.parse(listPageSchema, await (await fetchWithRetry(url(`/list?${q}`), {}, retry)).json());
        out.push(...page.keys);
        cursor = page.cursor;
      } while (cursor);
      return out;
    },
    async delete(key) {
      const res = await fetchWithRetry(url(keyPath("o", key)), { method: "DELETE" }, retry);
      await res.body?.cancel();
    },
    put: (key, body, contentType) => upload(key, body, contentType ? { contentType } : {}),
    putJson: (key, value) => upload(key, JSON.stringify(value), { contentType: "application/json" }),
    async putObj(body, meta) {
      const sha = await sha256Of(body);
      if (!(await client.head(keys.obj(sha)))) await upload(keys.obj(sha), body, { sha256: sha });
      if (!(await client.head(keys.meta(sha)))) {
        const size = body instanceof Uint8Array ? body.length : (await stat(body.file)).size;
        const record: ObjMeta = { ...meta, sha256: sha, size, storedAt: new Date().toISOString() };
        await client.putJson(keys.meta(sha), record);
      }
      return sha;
    },
  };
  return client;
}
