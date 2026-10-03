/** OS releases (releases/<platform>/<id>.json): what an iOS or Pixel build carries for each source. */

import { error } from "@sveltejs/kit";
import { keys, type ReleaseSummary } from "#lib/storage/keys.ts";
import { sourcePath, parseSourceKey, type AppleRelease, type ImageModem, type Platform, type Release } from "#lib/schema/types.ts";
import { perRequest } from "./cache";
import { isIndexed, releaseList } from "./catalog";
import { readJson } from "./store";
import * as records from "./records";

const releaseOf = perRequest((platform: Platform, id: string) => readJson(keys.release(platform, id), records.release));

export async function mustRelease(platform: Platform, id: string): Promise<Release> {
  const r = await releaseOf(platform, id);
  if (!r) error(404, `No ${platform} release ${id}.`);
  return r;
}

/** An iOS build and its modem packages. */
export async function releaseModems(id: string): Promise<{ release: AppleRelease; modems: readonly ImageModem[] }> {
  const release = await mustRelease("ios", id);
  if (release.platform === "android") error(500, `releases/ios/${id}.json is an Android release`);
  return { release, modems: release.modems };
}

export interface SourceChange {
  readonly source: string;
  /** Its source page, when the index has the source. */
  readonly path: string | null;
  readonly from: string | null;
  readonly to: string | null;
}

export interface ReleaseView {
  readonly release: Release;
  readonly previous: { readonly id: string; readonly version: string } | null;
  readonly added: readonly SourceChange[];
  readonly removed: readonly SourceChange[];
  readonly changed: readonly SourceChange[];
}

/** A source's content in a release, and its version: Apple's bundle, or Android's files across device groups. */
function contentOf(r: Release, key: string): { id: string; version: string } | null {
  if (r.platform === "android") {
    const files = r.sources[key];
    return files?.length ? { id: files.map((f) => f.sha).sort().join(","), version: files.map((f) => f.version).sort().at(-1) ?? "" } : null;
  }
  const a = r.sources[key];
  return a ? { id: a.cid, version: a.version } : null;
}

/** Sources added, removed and changed against the platform's previous release. */
export async function getRelease(platform: Platform, id: string): Promise<ReleaseView> {
  const mine = (await releaseList()).filter((r) => r.platform === platform);
  const before = mine[mine.findIndex((r) => r.id === id) + 1];
  const [now, was] = await Promise.all([mustRelease(platform, id), before ? mustRelease(platform, before.id) : null]);
  const all = [...new Set([...Object.keys(now.sources), ...Object.keys(was?.sources ?? {})])].sort();
  const changes = await Promise.all(all.map(async (k): Promise<{ change: SourceChange; kind: "added" | "removed" | "changed" | "same" }> => {
    const a = was ? contentOf(was, k) : null;
    const b = contentOf(now, k);
    const ref = parseSourceKey(k);
    const path = ref && (await isIndexed(k)) ? sourcePath(ref) : null;
    const change = { source: k, path, from: a?.version ?? null, to: b?.version ?? null };
    const kind = !a ? (was ? "added" : "same") : !b ? "removed" : a.id === b.id ? "same" : "changed";
    return { change, kind };
  }));
  const of = (kind: string): SourceChange[] => changes.filter((c) => c.kind === kind).map((c) => c.change);
  return {
    release: now,
    previous: was && { id: was.id, version: was.version },
    added: of("added"),
    removed: of("removed"),
    changed: of("changed"),
  };
}

/** Every release of a platform, newest first. */
export async function releasesOf(platform: Platform): Promise<ReleaseSummary[]> {
  return (await releaseList()).filter((r) => r.platform === platform);
}
