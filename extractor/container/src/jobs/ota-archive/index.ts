/**
 * ios.ota-archive: keep every carrier and country bundle Apple publishes over
 * the air, after Apple drops it.
 *
 * 1. Fetch the manifest (a query string of its own reaches a fresh copy past
 *    Apple's CDN) and snapshot it under its sha1 when new.
 * 2. Merge what it lists into feeds/ios-ota/refs.json.
 * 3. Download each URL not archived yet, once however many refs share it,
 *    verify Apple's digests, and store it as an ios.ipcc artifact. A failure is
 *    recorded on the refs and retried by the next run.
 * 4. Write refs.json, last: a run that dies early leaves the old one intact.
 */

import { createHash } from "node:crypto";

import { contentId, manifestTables, MANIFEST_URL, openIpcc, parseManifest } from "../../../../../src/lib/decode/index.ts";
import { sha1Hex } from "../../../../../src/lib/binary/index.ts";
import { keys, type OtaRef } from "../../../../../src/lib/storage/keys.ts";
import { fanOut } from "../../../../src/fan-out.ts";
import type { JobContext, JobOutput } from "../../job.ts";
import { fetchApple } from "../shared/apple.ts";
import { otaRefsSchema, readRecord } from "../shared/records.ts";
import { listedRefs, mergeRefs } from "./refs.ts";

/** Parallel downloads from Apple. */
const DOWNLOADS = 6;

interface Archived {
  readonly sha: string;
  readonly cid: string;
}

/** Throws when the bytes are not the file Apple's manifest describes. */
function verify(url: string, bytes: Uint8Array, sha1: string | undefined, sha384: string | undefined): void {
  if (sha1 !== undefined && sha1Hex(bytes) !== sha1) throw new Error(`${url}: sha1 mismatch`);
  if (sha384 !== undefined && createHash("sha384").update(bytes).digest("hex") !== sha384) throw new Error(`${url}: sha384 mismatch`);
}

/** One URL to download, and every ref that lists it (their digests are the URL's). */
interface Pending {
  readonly url: string;
  readonly refs: readonly OtaRef[];
}

async function archive(ctx: JobContext<"ios.ota-archive">, { url, refs }: Pending): Promise<Archived> {
  const bytes = await fetchApple(url);
  const sha1 = refs.find((r) => r.sha1)?.sha1;
  const sha384 = refs.find((r) => r.sha384)?.sha384;
  verify(url, bytes, sha1, sha384);
  const cid = await contentId(openIpcc(bytes));
  const sha = await ctx.r2.putObj(bytes, {
    kind: "ios.ipcc",
    cid,
    ...(sha1 !== undefined ? { sha1 } : {}),
    ...(sha384 !== undefined ? { sha384 } : {}),
    origin: { url },
  });
  return { sha, cid };
}

export async function otaArchive(ctx: JobContext<"ios.ota-archive">): Promise<JobOutput<"ios.ota-archive">> {
  const now = new Date().toISOString();
  const manifest = await fetchApple(`${MANIFEST_URL}?t=${Date.now()}`);
  const manifestSha1 = sha1Hex(manifest);
  const snapshot = keys.otaManifest(manifestSha1);
  const isNewManifest = !(await ctx.r2.head(snapshot));
  if (isNewManifest) await ctx.r2.put(snapshot, manifest, "application/xml");

  const previous = (await readRecord(ctx.r2, keys.otaRefs(), otaRefsSchema)) ?? [];
  const merged = mergeRefs(previous, listedRefs(manifestTables(parseManifest(manifest))), now);
  const refs = merged.refs;

  // URLs already archived under another ref need no download.
  const known = new Map(refs.flatMap((r) => (r.sha && r.cid ? [[r.url, { sha: r.sha, cid: r.cid }] as const] : [])));
  const pending = new Map<string, OtaRef[]>();
  for (const r of refs) {
    if (r.sha) continue;
    if (!known.has(r.url)) pending.set(r.url, [...(pending.get(r.url) ?? []), r]);
  }
  const todo: Pending[] = [...pending].map(([url, group]) => ({ url, refs: group })).slice(0, ctx.spec.params.limit ?? Infinity);
  ctx.log(`${refs.length} refs, ${pending.size} URLs to archive${todo.length < pending.size ? `, ${todo.length} this run` : ""}`);

  let done = 0;
  const results = await fanOut(todo, DOWNLOADS, async (group) => {
    const got = await archive(ctx, group);
    await ctx.progress(++done, todo.length);
    return got;
  });
  const failedUrls = new Map<string, string>();
  // fanOut keeps input order: results[i] is todo[i]'s.
  todo.forEach(({ url }, i) => {
    const r = results[i];
    if (r?.ok) known.set(url, r.value);
    else failedUrls.set(url, r?.error ?? "no result");
  });

  const shas = new Set<string>();
  let archived = 0;
  const final = refs.map((r): OtaRef => {
    if (r.sha) return r;
    const hit = known.get(r.url);
    if (hit) {
      archived++;
      shas.add(hit.sha);
      const { error, ...rest } = r;
      if (error !== undefined) ctx.log(`${r.url}: archived after an earlier failure (${error})`);
      return { ...rest, sha: hit.sha, cid: hit.cid };
    }
    const error = failedUrls.get(r.url);
    return error === undefined ? r : { ...r, error };
  });
  await ctx.r2.putJson(keys.otaRefs(), final);

  return {
    shas: [...shas].sort(),
    changed: merged.changed || archived > 0,
    refs: final.length,
    archived,
    failed: failedUrls.size,
    manifest: isNewManifest ? manifestSha1 : null,
  };
}
