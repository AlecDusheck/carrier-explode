import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { keys } from "@carrier-explode/storage";
import { specOf } from "../src/jobs.ts";
import { createContext } from "../container/src/runtime/context.ts";
import type { R2Client } from "../container/src/job.ts";
import { dirR2Client } from "../dev/dir-r2.ts";

const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");
const spec = specOf("test:ios.release:0", "ios.release", { build: "23C55", version: "27.2", label: "27.2", prerelease: false, parts: [], modems: "test:ios.modems:0" });

let dir: string;
let bucket: R2Client;
let r2: R2Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "r2-"));
  bucket = dirR2Client(dir);
  r2 = createContext(spec, dir, { r2: bucket, log: () => undefined }).r2;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a job's R2 client", () => {
  it("writes and deletes only under its job's prefixes", async () => {
    await r2.putJson("releases/ios/23C55.json", { id: "23C55" });
    expect(await r2.getJson("releases/ios/23C55.json")).toEqual({ id: "23C55" });
    await expect(r2.putJson("index/carriers.json", [])).rejects.toThrow(/may not write/);
    await expect(r2.delete("releases/ios/23C55.json")).rejects.toThrow(/may not delete/);
    await bucket.put("staging/j/x", "");
    await r2.delete("staging/j/x");
    expect(await r2.head("staging/j/x")).toBeNull();
  });

  it("stores an artifact once, with its first origin", async () => {
    const bytes = new TextEncoder().encode("ipcc bytes");
    const sha = await r2.putObj(bytes, { kind: "apple.ipcc", cid: "c", origin: { kind: "download", url: "https://a.example/1" } });
    expect(sha).toBe(sha256(bytes));
    await r2.putObj(bytes, { kind: "apple.ipcc", cid: "c", origin: { kind: "download", url: "https://a.example/2" } });
    expect(await r2.getJson(keys.meta(sha))).toMatchObject({ sha, size: bytes.length, origin: { url: "https://a.example/1" } });
    expect(await r2.get(keys.obj(sha))).toEqual(bytes);
  });

  it("stores a file from disk", async () => {
    const file = join(dir, "big.bin");
    const big = new Uint8Array(2500).map((_, i) => i % 251);
    await writeFile(file, big);
    const sha = await r2.putObj({ file }, { kind: "apple.bbfw", origin: { kind: "image", release: "23C55", device: "iPhone17,1", path: "Firmware/x.bbfw" } });
    expect(sha).toBe(sha256(big));
    expect(await r2.getJson(keys.meta(sha))).toMatchObject({ size: 2500, kind: "apple.bbfw" });
  });
});
