/**
 * The Store port over a directory: `<root>/<key>` per object, multipart parts
 * staged under `<root>/.mpu/<uploadId>/`. What the dev harness serves as R2, so
 * jobs run here against exactly the protocol code the Worker runs.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type Stats } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { RequestError } from "../src/protocol/errors.ts";
import type { ListPage, Store, StoredObject, UploadedPart } from "../src/protocol/store.ts";

const LIST_PAGE = 1000;
const STAGING = ".mpu";

const isMissing = (e: unknown): boolean => e instanceof Error && "code" in e && e.code === "ENOENT";

/** stat, or null when nothing is there. */
async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

async function stored(path: string): Promise<StoredObject | null> {
  const s = await statOrNull(path);
  return s?.isFile() ? { size: s.size, etag: `${s.size}-${Math.trunc(s.mtimeMs)}` } : null;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (isMissing(e)) return;
    throw e;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

/** Writes `body` to `path` via a temp file, checking its length and, when given, its sha256. */
async function writeChecked(path: string, body: ReadableStream<Uint8Array>, size: number, sha256?: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  const hash = createHash("sha256");
  let length = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, next) {
      length += chunk.length;
      hash.update(chunk);
      next(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body), tap, createWriteStream(tmp));
    if (length !== size) throw new RequestError(400, `body was ${length} bytes, Content-Length said ${size}`);
    const got = hash.digest("hex");
    if (sha256 !== undefined && got !== sha256) throw new RequestError(400, `body hashes to ${got}, not ${sha256}`);
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

export function dirStore(root: string): Store {
  const pathOf = (key: string): string => join(root, ...key.split("/"));
  const staging = (uploadId: string): string => join(root, STAGING, uploadId);

  return {
    head: (key) => stored(pathOf(key)),
    async get(key) {
      const meta = await stored(pathOf(key));
      if (!meta) return null;
      return { ...meta, body: Readable.toWeb(createReadStream(pathOf(key))) };
    },
    put: (key, body, size, opts) => writeChecked(pathOf(key), body, size, opts.sha256),
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    async list(prefix, cursor): Promise<ListPage> {
      const all: string[] = [];
      for await (const p of walk(root)) {
        const key = relative(root, p).split(sep).join("/");
        if (!key.startsWith(`${STAGING}/`) && key.startsWith(prefix)) all.push(key);
      }
      all.sort();
      const from = cursor === undefined ? 0 : Number(cursor);
      const keys = all.slice(from, from + LIST_PAGE);
      return from + LIST_PAGE < all.length ? { keys, cursor: String(from + LIST_PAGE) } : { keys };
    },
    async createMultipart() {
      const uploadId = randomUUID();
      await mkdir(staging(uploadId), { recursive: true });
      return uploadId;
    },
    async uploadPart(_key, uploadId, partNumber, body, size): Promise<UploadedPart> {
      if (!(await statOrNull(staging(uploadId)))?.isDirectory()) throw new RequestError(404, `no upload ${uploadId}`);
      const path = join(staging(uploadId), String(partNumber));
      await writeChecked(path, body, size);
      const s = await stored(path);
      return { partNumber, etag: s?.etag ?? "" };
    },
    async completeMultipart(key, uploadId, parts) {
      const dir = staging(uploadId);
      await mkdir(dirname(pathOf(key)), { recursive: true });
      // One part in memory at a time: parts are at most PART_SIZE.
      const out = await open(pathOf(key), "w");
      try {
        for (const { partNumber } of parts) await out.write(await readFile(join(dir, String(partNumber))));
      } finally {
        await out.close();
      }
      await rm(dir, { recursive: true, force: true });
    },
    async abortMultipart(_key, uploadId) {
      await rm(staging(uploadId), { recursive: true, force: true });
    },
    async sha256(key) {
      if (!(await stored(pathOf(key)))) return null;
      const hash = createHash("sha256");
      await pipeline(createReadStream(pathOf(key)), hash);
      return hash.digest("hex");
    },
  };
}
