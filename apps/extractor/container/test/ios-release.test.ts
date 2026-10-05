// ios.release through its context, held to the job's own scope: staged copies in, merged bundles in obj/, staging gone, retries safe.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as v from "valibot";
import { afterEach, describe, expect, it } from "vitest";

import { unpackIpcc, type UnpackedBundle } from "@carrier-explode/decode-ios";
import { releaseSchema } from "@carrier-explode/schema/records";
import { keys } from "@carrier-explode/storage";
import { specOf } from "../../src/jobs.ts";
import { dirR2Client } from "../../dev/dir-r2.ts";
import { packBundle } from "../src/jobs/ios/bundle-artifact.ts";
import { runRelease } from "../src/jobs/ios/release/job.ts";
import type { JobOutput } from "../../src/jobs.ts";
import type { R2Client } from "../src/job.ts";
import { createContext } from "../src/runtime/context.ts";

const enc = new TextEncoder();

const INFO = enc.encode(`<plist version="1.0"><dict><key>CFBundleVersion</key><string>72.0</string></dict></plist>`);
const bundle = (name: string, extra: Record<string, string>): UnpackedBundle => ({
  name,
  files: [{ path: "Info.plist", bytes: INFO }, { path: "carrier.plist", bytes: enc.encode("<plist/>") }, ...Object.entries(extra).map(([path, t]) => ({ path, bytes: enc.encode(t) }))],
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** An empty bucket in a fresh directory. */
async function emptyBucket(): Promise<R2Client> {
  const dir = await mkdtemp(join(tmpdir(), "release-"));
  dirs.push(dir);
  return dirR2Client(dir);
}

/** Stages one IPSW's bundles as ios.ipsw would, and records its job output, straight into the bucket: setup, not the job's writes. */
async function stage(store: R2Client, id: string, device: string, bundles: readonly UnpackedBundle[]): Promise<void> {
  const out = [];
  for (const b of bundles) {
    const { bytes, artifact } = await packBundle(b);
    const source = `ios:carrier:${b.name}` as const;
    await store.put(keys.staging(id, source), bytes);
    out.push({ source, ...artifact });
  }
  await store.putJson(keys.job(id), { result: { ok: true, output: { build: "24A446", device, devices: [device], bundles: out } } });
}

const spec = specOf("r:ios.release:24A446", "ios.release", {
  build: "24A446", version: "27.0.1", label: "27.0.1", prerelease: false, parts: ["p:ios.ipsw:0", "p:ios.ipsw:1"], modems: "p:ios.modems:0",
});

/** Runs ios.release against `store` through its context, which holds it to JOBS["ios.release"]. */
const release = (store: R2Client): Promise<JobOutput<"ios.release">> => runRelease(createContext(spec, "", { r2: store, log: () => undefined }));

const under = (store: R2Client, prefix: string): Promise<readonly string[]> => store.list(prefix);

async function bucket(): Promise<R2Client> {
  const store = await emptyBucket();
  await stage(store, "p:ios.ipsw:0", "iPhone17,1", [bundle("Same_us", {}), bundle("Split_us", { "overrides_D93.plist": "93" })]);
  await stage(store, "p:ios.ipsw:1", "iPhone17,3", [bundle("Same_us", {}), bundle("Split_us", { "overrides_D47.plist": "47" })]);
  await store.putJson(keys.job("p:ios.modems:0"), { result: { ok: true, output: { modems: [] } } });
  return store;
}

describe("ios.release", () => {
  it("stores only the merged bundles, writes the release, then deletes its staging", async () => {
    const store = await bucket();
    const out = await release(store);
    expect((await under(store, "obj/")).map((k) => k.slice(4))).toEqual(out.shas);
    expect((await under(store, "meta/")).map((k) => k.slice(5, -".json".length))).toEqual(out.shas);
    expect(await under(store, "staging/")).toEqual([]);

    const written = v.parse(releaseSchema, await store.getJson(keys.release("ios", "24A446")));
    if (written.platform !== "ios") throw new Error("not an iOS release");
    const bytes = await store.get(keys.obj(written.sources["ios:carrier:Split_us"]?.sha ?? ""));
    expect(unpackIpcc(bytes ?? new Uint8Array()).files.map((f) => f.path)).toEqual(["Info.plist", "carrier.plist", "overrides_D47.plist", "overrides_D93.plist"]);
  });

  it("finishes an earlier attempt's cleanup instead of failing on the staging it already deleted", async () => {
    const store = await bucket();
    const first = await release(store);
    await store.put(keys.staging("p:ios.ipsw:1", "ios:carrier:Same_us"), new Uint8Array([1]));
    expect(await release(store)).toEqual(first);
    expect(await under(store, "staging/")).toEqual([]);
  });

  it("fails without touching the bucket when a copy conflicts", async () => {
    const store = await emptyBucket();
    await stage(store, "p:ios.ipsw:0", "iPhone17,1", [bundle("Split_us", { "ERI.plist": "a" })]);
    await stage(store, "p:ios.ipsw:1", "iPhone17,3", [bundle("Split_us", { "ERI.plist": "b" })]);
    await store.putJson(keys.job("p:ios.modems:0"), { result: { ok: true, output: { modems: [] } } });
    await expect(release(store)).rejects.toThrow(/Split_us\.bundle\/ERI\.plist differs between IPSWs/);
    expect((await store.list("")).filter((k) => !k.startsWith("jobs/"))).toEqual([
      keys.staging("p:ios.ipsw:0", "ios:carrier:Split_us"), keys.staging("p:ios.ipsw:1", "ios:carrier:Split_us"),
    ]);
  });
});
