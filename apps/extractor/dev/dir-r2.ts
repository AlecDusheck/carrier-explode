/** R2Client over a directory, `<root>/<key>`: the bucket for the dev job runner and the tests. */

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { sha256Hex } from "@carrier-explode/binary";
import { keys, type ObjMeta } from "@carrier-explode/storage";
import type { PutBody, R2Client } from "../container/src/job.ts";

const isMissing = (e: unknown): boolean => e instanceof Error && "code" in e && e.code === "ENOENT";

async function orNull<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await orNull(readdir(dir, { withFileTypes: true }));
  for (const e of entries ?? []) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* walk(path);
    else yield path;
  }
}

export function dirR2Client(root: string): R2Client {
  const path = (key: string): string => join(root, key);
  const put = async (key: string, body: PutBody): Promise<void> => {
    await mkdir(dirname(path(key)), { recursive: true });
    if (typeof body === "string" || body instanceof Uint8Array) await writeFile(path(key), body);
    else await copyFile(body.file, path(key));
  };
  const client: R2Client = {
    get: async (key) => {
      const bytes = await orNull(readFile(path(key)));
      return bytes && new Uint8Array(bytes);
    },
    async getJson(key) {
      const bytes = await client.get(key);
      return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
    },
    async head(key) {
      const s = await orNull(stat(path(key)));
      return s?.isFile() ? { size: s.size, uploaded: s.mtime } : null;
    },
    async list(prefix) {
      const out: string[] = [];
      for await (const file of walk(root)) {
        const key = relative(root, file).split(sep).join("/");
        if (key.startsWith(prefix)) out.push(key);
      }
      return out.sort();
    },
    put,
    putJson: (key, value) => put(key, JSON.stringify(value)),
    delete: (key) => rm(path(key), { force: true }),
    async putObj(body, claim) {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await readFile(body.file));
      const sha = await sha256Hex(bytes);
      if (!(await client.head(keys.obj(sha)))) await put(keys.obj(sha), bytes);
      if (!(await client.head(keys.meta(sha)))) {
        const record: ObjMeta = { ...claim, sha, size: bytes.length, storedAt: new Date().toISOString() };
        await client.putJson(keys.meta(sha), record);
      }
      return sha;
    },
  };
  return client;
}
