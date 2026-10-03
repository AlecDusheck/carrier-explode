/**
 * ios.ota-archive: keep every bundle Apple publishes over the air after Apple
 * drops it. Snapshot the manifest, merge its entries into refs.json, archive
 * each URL not archived yet (verified against Apple's digest), write refs.json last.
 */

import { createHash } from "node:crypto";

import { contentId, manifestTables, openIpcc, parseManifest } from "../../../../../src/lib/decode/index.ts";
import { sha1Hex } from "../../../../../src/lib/binary/index.ts";
import type { Archive, Digest } from "../../../../../src/lib/schema/index.ts";
import { keys, type OtaRef } from "../../../../../src/lib/storage/keys.ts";
import { fanOut } from "../../../../src/fan-out.ts";
import type { JobContext, JobOutput } from "../../job.ts";
import { fetchApple, fetchManifest } from "../shared/apple.ts";
import { otaRefsSchema, readRecord } from "../shared/records.ts";
import { listedRefs, mergeRefs } from "./refs.ts";

/** Parallel downloads from Apple. */
const DOWNLOADS = 6;

type Archived = Extract<Archive, { state: "archived" }>;

const hexOf = (algorithm: Digest["algorithm"], bytes: Uint8Array): string =>
  algorithm === "sha1" ? sha1Hex(bytes) : createHash("sha384").update(bytes).digest("hex");

async function archive(ctx: JobContext<"ios.ota-archive">, url: string, digest: Digest | undefined): Promise<Archived> {
  const bytes = await fetchApple(url);
  if (digest && hexOf(digest.algorithm, bytes) !== digest.hex) throw new Error(`${digest.algorithm} mismatch`);
  const cid = await contentId(openIpcc(bytes));
  const sha = await ctx.r2.putObj(bytes, { kind: "apple.ipcc", cid, origin: { via: "download", url } });
  return { state: "archived", sha, cid };
}

/** URL → its archive, for URLs some ref already has archived. */
const archivedUrls = (refs: readonly OtaRef[]): Map<string, Archived> =>
  new Map(refs.flatMap((r) => (r.archive.state === "archived" ? [[r.url, r.archive] as const] : [])));

export async function otaArchive(ctx: JobContext<"ios.ota-archive">): Promise<JobOutput<"ios.ota-archive">> {
  const manifest = await fetchManifest();
  const manifestSha1 = sha1Hex(manifest);
  const isNewManifest = !(await ctx.r2.head(keys.otaManifest(manifestSha1)));
  if (isNewManifest) await ctx.r2.put(keys.otaManifest(manifestSha1), manifest, "application/xml");

  const previous = (await readRecord(ctx.r2, keys.otaRefs(), otaRefsSchema)) ?? [];
  const merged = mergeRefs(previous, listedRefs(manifestTables(parseManifest(manifest))), new Date().toISOString());
  const known = archivedUrls(merged.refs);
  const pending = new Map<string, Digest | undefined>();
  for (const r of merged.refs) if (!known.has(r.url) && !pending.has(r.url)) pending.set(r.url, r.digest);
  const todo = [...pending].slice(0, ctx.spec.params.limit ?? pending.size);
  ctx.log(`${merged.refs.length} refs, ${pending.size} URLs to archive, ${todo.length} this run`);

  let done = 0;
  const results = await fanOut(todo, DOWNLOADS, async ([url, digest]) => {
    const got = await archive(ctx, url, digest);
    await ctx.progress(++done, todo.length);
    return got;
  });
  const outcomes = new Map<string, Archive>(results.map((r) => [r.item[0], r.ok ? r.value : { state: "failed", error: r.error }]));

  const shas = new Set<string>();
  const refs = merged.refs.map((r): OtaRef => {
    if (r.archive.state === "archived") return r;
    const next = known.get(r.url) ?? outcomes.get(r.url);
    if (next?.state === "archived") shas.add(next.sha);
    return next ? { ...r, archive: next } : r;
  });
  await ctx.r2.putJson(keys.otaRefs(), refs);

  const failed = [...outcomes.values()].filter((a) => a.state === "failed").length;
  return {
    shas: [...shas].sort(),
    changed: merged.changed || shas.size > 0,
    refs: refs.length,
    archived: shas.size,
    failed,
    manifest: isNewManifest ? manifestSha1 : null,
  };
}
