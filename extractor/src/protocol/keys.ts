/**
 * R2 keys as they cross r2.internal: validation, the URL encoding both ends
 * use, and write scoping. A key travels as `/o/<seg>/<seg>` with each segment
 * percent-encoded, so keys that themselves contain `%` or `?` (scan shards
 * are named with encodeURIComponent) survive exactly.
 */

import { WRITABLE_PREFIXES } from "../../../src/lib/storage/keys.ts";
import { RequestError } from "./errors.ts";

const MAX_KEY_BYTES = 1024;
const SHA256 = /^[0-9a-f]{64}$/;

/** Throws a 400 unless `key` is a plain relative path: no empty, `.` or `..` segments, no control characters. */
export function checkKey(key: string): string {
  if (!key || new TextEncoder().encode(key).length > MAX_KEY_BYTES) throw new RequestError(400, "key must be 1..1024 bytes");
  if (/[\u0000-\u001f\u007f]/.test(key)) throw new RequestError(400, "key has control characters");
  for (const seg of key.split("/")) {
    if (seg === "" || seg === "." || seg === "..") throw new RequestError(400, `bad key segment in ${JSON.stringify(key)}`);
  }
  return key;
}

/** `/<base>/<encoded key>`, the path both ends build. */
export const keyPath = (base: "o" | "mpu", key: string): string => `/${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** The key in a request path under `/<base>/`, decoded segment by segment and checked. */
export function keyFromPath(pathname: string, base: "o" | "mpu"): string {
  const rest = pathname.slice(base.length + 2);
  let key: string;
  try {
    key = rest.split("/").map(decodeURIComponent).join("/");
  } catch {
    throw new RequestError(400, `bad percent-encoding in ${pathname}`);
  }
  return checkKey(key);
}

/** Prefixes whose objects never change: a second write of the same key is a no-op, not an overwrite. */
export const isCreateOnly = (key: string): boolean => key.startsWith("obj/") || key.startsWith("meta/");

/**
 * Throws 403 unless `key` is under one of the job's prefixes, and those are
 * themselves under WRITABLE_PREFIXES (index/ is the index job's alone, and
 * so on: see JOBS in ../jobs.ts).
 */
export function checkWritable(key: string, writes: readonly string[]): void {
  const allowed = writes.some((p) => key.startsWith(p) && WRITABLE_PREFIXES.some((w) => p.startsWith(w)));
  if (!allowed) throw new RequestError(403, `${key}: not writable by this job (may write ${writes.join(", ") || "nothing"})`);
}

/** For obj/<sha>: the x-sha256 header must be present and name the same object. */
export function checkObjDigest(key: string, header: string | null): string | undefined {
  if (!key.startsWith("obj/")) return undefined;
  const sha = key.slice(4);
  if (!SHA256.test(sha)) throw new RequestError(400, `${key}: obj/ keys are a lower-case sha256`);
  if (header !== sha) throw new RequestError(400, `${key}: x-sha256 must be sent and equal the key's sha256`);
  return sha;
}
