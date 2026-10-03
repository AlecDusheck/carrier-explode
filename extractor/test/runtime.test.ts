import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HttpError } from "../../src/lib/http/index.ts";
import { keys } from "../../src/lib/storage/keys.ts";
import { specOf, type Progress } from "../src/jobs.ts";
import { createContext } from "../container/src/runtime/context.ts";
import type { ControlClient } from "../container/src/runtime/control-client.ts";
import { createR2Client } from "../container/src/runtime/r2-client.ts";
import type { R2Client } from "../container/src/job.ts";
import { startFakeServers, type FakeServers } from "../dev/fake-servers.ts";

const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");
const spec = specOf("test:ios.release:0", "ios.release", { build: "23C55", version: "27.2", label: "27.2", parts: [], modems: null });

let dir: string;
let fake: FakeServers;
let r2: R2Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "r2-"));
  fake = await startFakeServers({ dir, spec, scope: { writes: ["obj/", "meta/", "releases/ios/"] } });
  // Small parts, so the multipart path runs on test-sized files; few retries, so failures are quick.
  r2 = createR2Client(fake.r2, { retry: { tries: 2, backoff: 10 }, multipartAbove: 1024, partSize: 400 });
});

afterEach(async () => {
  await fake.close();
  await rm(dir, { recursive: true, force: true });
});

describe("R2 client against the fake r2.internal", () => {
  it("puts, gets, heads and deletes", async () => {
    await r2.putJson("releases/ios/23C55.json", { id: "23C55" });
    expect(await r2.getJson("releases/ios/23C55.json")).toEqual({ id: "23C55" });
    expect(await r2.head("releases/ios/23C55.json")).toEqual({ size: 14 });
    expect(await r2.get("releases/ios/none.json")).toBeNull();
    await r2.delete("releases/ios/23C55.json");
    expect(await r2.head("releases/ios/23C55.json")).toBeNull();
  });

  it("lists across pages", async () => {
    await Promise.all(Array.from({ length: 1003 }, (_, i) => r2.put(`releases/ios/${String(i).padStart(4, "0")}.json`, "{}")));
    const listed = await r2.list("releases/ios/");
    expect(listed).toHaveLength(1003);
    expect(listed[1002]).toBe("releases/ios/1002.json");
  });

  it("refuses writes outside the job's prefixes", async () => {
    const err: unknown = await r2.putJson("index/carriers.json", []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err instanceof HttpError && err.status).toBe(403);
  });

  it("stores an artifact once, and its first origin", async () => {
    const bytes = new TextEncoder().encode("ipcc bytes");
    const sha = await r2.putObj(bytes, { kind: "apple.ipcc", origin: { via: "download", url: "https://a.example/1" } });
    expect(sha).toBe(sha256(bytes));
    await r2.putObj(bytes, { kind: "apple.ipcc", origin: { via: "download", url: "https://a.example/2" } });
    expect(await r2.getJson(keys.meta(sha))).toMatchObject({ sha256: sha, size: bytes.length, origin: { url: "https://a.example/1" } });
    expect(await r2.get(keys.obj(sha))).toEqual(bytes);
  });

  it("uploads a large file in parts, hashed while streaming", async () => {
    const big = new Uint8Array(2500).map((_, i) => i % 251);
    const file = join(dir, "..", `big-${Date.now()}.bin`);
    await writeFile(file, big);
    try {
      const sha = await r2.putObj({ file }, { kind: "apple.bbfw", origin: { via: "image", release: "23C55", device: "iPhone17,1", path: "Firmware/x.bbfw" } });
      expect(sha).toBe(sha256(big));
      expect(await readFile(join(dir, "obj", sha))).toEqual(Buffer.from(big));
      expect(await r2.getJson(keys.meta(sha))).toMatchObject({ size: 2500, kind: "apple.bbfw" });
    } finally {
      await rm(file, { force: true });
    }
  });
});

describe("job context", () => {
  it("throttles progress but always sends completion", async () => {
    const sent: Progress[] = [];
    const control: ControlClient = { progress: async (p) => void sent.push(p), done: async () => undefined };
    const ctx = createContext(spec, dir, { r2, control, log: () => undefined });
    try {
      await ctx.progress(1, 10);
      await ctx.progress(2, 10);
      await ctx.progress(10, 10, "done");
    } finally {
      ctx.close();
    }
    expect(sent).toEqual([{ done: 1, total: 10 }, { done: 10, total: 10, note: "done" }]);
  });
});
