/**
 * The r2.internal protocol: what a container sees as R2. Written against the
 * Store port so the Worker (R2 binding) and the dev harness (a directory) run
 * the same code, checks included.
 *
 *   GET    /o/<key>                         body, or 404
 *   HEAD   /o/<key>                         content-length, or 404
 *   PUT    /o/<key>                         Content-Length required, ≤ MAX_PUT; obj/ needs x-sha256
 *   GET    /list?prefix=&cursor=            { keys, cursor? }
 *   POST   /mpu/<key>                       { uploadId }            obj/ needs x-sha256
 *   PUT    /mpu/<key>?uploadId=&part=N      { partNumber, etag }
 *   POST   /mpu/<key>?uploadId=             body { parts }, completes; obj/ is re-hashed and dropped on mismatch
 *   DELETE /mpu/<key>?uploadId=             aborts
 *
 * obj/ and meta/ are create-only: writing a key that exists answers 200
 * `{ exists: true }` and leaves the object alone, so the first origin wins.
 */

import * as v from "valibot";

import { readJson } from "./body.ts";
import { errorResponse, RequestError } from "./errors.ts";
import { checkObjDigest, checkWritable, isCreateOnly, keyFromPath } from "./keys.ts";
import { MAX_PUT } from "./limits.ts";
import type { Store } from "./store.ts";

/** What the calling job may do: the prefixes it may write. */
export interface R2Scope {
  readonly writes: readonly string[];
}

const partsSchema = v.object({
  parts: v.pipe(
    v.array(v.object({ partNumber: v.pipe(v.number(), v.integer(), v.minValue(1)), etag: v.string() })),
    v.minLength(1),
  ),
});

export async function handleR2(req: Request, store: Store, scope: R2Scope): Promise<Response> {
  try {
    return await route(req, store, scope);
  } catch (e) {
    return errorResponse(e);
  }
}

function route(req: Request, store: Store, scope: R2Scope): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/list" && req.method === "GET") return list(url, store);
  if (url.pathname.startsWith("/o/")) {
    const key = keyFromPath(url.pathname, "o");
    switch (req.method) {
      case "GET": return get(key, store);
      case "HEAD": return head(key, store);
      case "PUT": return put(key, req, store, scope);
    }
  }
  if (url.pathname.startsWith("/mpu/")) {
    const key = keyFromPath(url.pathname, "mpu");
    const uploadId = url.searchParams.get("uploadId");
    if (req.method === "POST" && uploadId === null) return createUpload(key, req, store, scope);
    if (uploadId === null) throw new RequestError(400, "uploadId is required");
    checkWritable(key, scope.writes);
    switch (req.method) {
      case "PUT": return uploadPart(key, uploadId, url, req, store);
      case "POST": return completeUpload(key, uploadId, req, store);
      case "DELETE": return abortUpload(key, uploadId, store);
    }
  }
  throw new RequestError(req.method === "GET" || req.method === "HEAD" ? 404 : 405, `${req.method} ${url.pathname}: no such route`);
}

async function list(url: URL, store: Store): Promise<Response> {
  const prefix = url.searchParams.get("prefix") ?? "";
  const cursor = url.searchParams.get("cursor");
  return Response.json(await store.list(prefix, cursor ?? undefined));
}

async function get(key: string, store: Store): Promise<Response> {
  const obj = await store.get(key);
  if (!obj) throw new RequestError(404, `${key}: not found`);
  return new Response(obj.body, { headers: { "content-length": String(obj.size), etag: obj.etag } });
}

async function head(key: string, store: Store): Promise<Response> {
  const obj = await store.head(key);
  if (!obj) throw new RequestError(404, `${key}: not found`);
  return new Response(null, { headers: { "content-length": String(obj.size), etag: obj.etag } });
}

/** Content-Length as a number, or a 411/400. The stores need the length up front (R2 streams must have one). */
function lengthOf(req: Request): number {
  const header = req.headers.get("content-length");
  if (header === null) throw new RequestError(411, "Content-Length is required");
  const n = Number(header);
  if (!Number.isSafeInteger(n) || n < 0) throw new RequestError(400, `bad Content-Length ${header}`);
  return n;
}

/** The request body; a bodiless request is an empty stream, so zero-byte objects work. */
const bodyOf = (req: Request): ReadableStream<Uint8Array> => req.body ?? new ReadableStream({ start: (c) => c.close() });

async function put(key: string, req: Request, store: Store, scope: R2Scope): Promise<Response> {
  checkWritable(key, scope.writes);
  const sha256 = checkObjDigest(key, req.headers.get("x-sha256"));
  const size = lengthOf(req);
  if (size > MAX_PUT) throw new RequestError(413, `${size} bytes: use multipart above ${MAX_PUT}`);
  if (isCreateOnly(key) && (await store.head(key))) {
    await req.body?.cancel();
    return Response.json({ exists: true });
  }
  const contentType = req.headers.get("content-type");
  await store.put(key, bodyOf(req), size, { ...(sha256 ? { sha256 } : {}), ...(contentType ? { contentType } : {}) });
  return Response.json({ exists: false }, { status: 201 });
}

async function createUpload(key: string, req: Request, store: Store, scope: R2Scope): Promise<Response> {
  checkWritable(key, scope.writes);
  checkObjDigest(key, req.headers.get("x-sha256"));
  if (isCreateOnly(key) && (await store.head(key))) return Response.json({ exists: true });
  const contentType = req.headers.get("content-type");
  return Response.json({ exists: false, uploadId: await store.createMultipart(key, contentType ?? undefined) }, { status: 201 });
}

async function uploadPart(key: string, uploadId: string, url: URL, req: Request, store: Store): Promise<Response> {
  const partNumber = Number(url.searchParams.get("part"));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) throw new RequestError(400, "part must be 1..10000");
  const size = lengthOf(req);
  if (size > MAX_PUT) throw new RequestError(413, `part of ${size} bytes is over ${MAX_PUT}`);
  return Response.json(await store.uploadPart(key, uploadId, partNumber, bodyOf(req), size));
}

async function completeUpload(key: string, uploadId: string, req: Request, store: Store): Promise<Response> {
  const { parts: given } = await readJson(req, partsSchema);
  const parts = [...given].sort((a, b) => a.partNumber - b.partNumber);
  await store.completeMultipart(key, uploadId, parts);
  if (key.startsWith("obj/")) {
    // R2 verifies no digest for multipart objects, so the assembled bytes are hashed here.
    const got = await store.sha256(key);
    if (got !== key.slice(4)) {
      await store.delete(key);
      throw new RequestError(400, `${key}: assembled object hashes to ${got ?? "nothing"}; deleted`);
    }
  }
  return Response.json({ exists: false }, { status: 201 });
}

async function abortUpload(key: string, uploadId: string, store: Store): Promise<Response> {
  await store.abortMultipart(key, uploadId);
  return new Response(null, { status: 204 });
}
