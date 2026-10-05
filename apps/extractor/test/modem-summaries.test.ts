import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MODEM_SUMMARY_SCHEMA } from "@carrier-explode/decode-ios";
import type { AppleRelease } from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import { parseOutput, specOf, type JobOutput, type JobResult } from "../src/jobs.ts";
import { RUNNERS } from "../container/src/jobs/index.ts";
import { executeJob } from "../container/src/runtime/execute.ts";
import { dirR2Client } from "../dev/dir-r2.ts";

/** The smallest valid rkos/ftab: the magic at 0x20, no entries. */
const ftab = new Uint8Array(0x30);
ftab.set(new TextEncoder().encode("rkosftab"), 0x20);
const sha = createHash("sha256").update(ftab).digest("hex");

const release: AppleRelease = {
  platform: "ios", id: "24A437", version: "27.0", devices: ["iPhone17,5"], extractedAt: "2026-10-01T00:00:00.000Z",
  label: "27.0", prerelease: false, sources: {},
  modems: [{ family: "c4000", devices: ["iPhone17,5"], package: { kind: "ftab", name: "c4000v59/Release/patched/ftab.bin", sha, size: ftab.length, crc32: "00000000" } }],
};

let dir: string;

async function run(rewriteBefore?: string): Promise<JobResult> {
  const spec = specOf(`test:ios.modem-summaries:${rewriteBefore ?? "new"}`, "ios.modem-summaries", { shard: 0, of: 1, ...(rewriteBefore === undefined ? {} : { rewriteBefore }) });
  return executeJob(RUNNERS, spec, { r2: dirR2Client(dir), log: () => undefined });
}

const tallyOf = (r: JobResult): JobOutput<"ios.modem-summaries"> | string => (r.ok ? parseOutput("ios.modem-summaries", r.output) : r.error);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "modems-"));
  await mkdir(join(dir, "obj"), { recursive: true });
  await mkdir(join(dir, "releases", "ios"), { recursive: true });
  await writeFile(join(dir, keys.obj(sha)), ftab);
  await writeFile(join(dir, keys.release("ios", release.id)), JSON.stringify(release));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ios.modem-summaries", () => {
  it("decodes every listed package into the current schema's key, then skips it", async () => {
    expect(tallyOf(await run())).toEqual({ written: 1, skipped: 0, failed: 0, failures: [] });
    const summary: unknown = JSON.parse(await readFile(join(dir, keys.modemSummary(MODEM_SUMMARY_SCHEMA, sha)), "utf8"));
    expect(summary).toMatchObject({ package: { name: release.modems[0]?.package.name } });
    expect(tallyOf(await run())).toMatchObject({ written: 0, skipped: 1 });
  });

  it("rewrites a summary written before a reindex began, and keeps one written since", async () => {
    const key = join(dir, keys.modemSummary(MODEM_SUMMARY_SCHEMA, sha));
    await utimes(key, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    expect(tallyOf(await run("2026-06-01T00:00:00.000Z"))).toMatchObject({ written: 1, skipped: 0 });
    expect(tallyOf(await run("2026-06-01T00:00:00.000Z"))).toMatchObject({ written: 0, skipped: 1 });
  });
});
