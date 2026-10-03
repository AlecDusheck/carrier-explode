/**
 * OS releases: an iOS build or a Pixel build, and what its image carries for
 * each source (releases/<platform>/<id>.json, written by the extractor).
 */

import { error } from "@sveltejs/kit";
import * as v from "valibot";
import { keys } from "#lib/storage/keys.ts";
import type { Platform, Release } from "#lib/schema/types.ts";
import { perRequest } from "./cache";
import { releaseList, sourceSlugs } from "./catalog";
import { readJson } from "./store";
import * as records from "./records";

const releaseOf = perRequest((platform: Platform, id: string) => readJson(keys.release(platform, id), records.release));

export async function mustRelease(platform: Platform, id: string): Promise<Release> {
  const r = await releaseOf(platform, id);
  if (!r) error(404, `No ${platform === "ios" ? "iOS" : "Android"} release ${id}.`);
  return r;
}

/** An iOS release's modem packages, in the v1 image index shape the baseband pages read. */
export async function releaseModems(id: string): Promise<{ release: Release; modems: records.ImageModem[] }> {
  const release = await mustRelease("ios", id);
  const parsed = v.safeParse(v.array(records.imageModem), release.modems ?? []);
  if (!parsed.success) error(500, `releases/ios/${id}.json: modems do not match their shape: ${v.summarize(parsed.issues)}`);
  return { release, modems: parsed.output };
}

/** One source's change between a release and the one before it on the same platform. */
export interface SourceChange {
  readonly source: string;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface ReleaseView {
  readonly release: Release;
  readonly previous: { readonly id: string; readonly version: string } | null;
  readonly added: readonly SourceChange[];
  readonly removed: readonly SourceChange[];
  readonly changed: readonly SourceChange[];
  /** Sources with a carrier page: the rest are not indexed yet. */
  readonly linked: readonly string[];
}

/**
 * Sources added, removed and changed against the platform's previous release.
 * iOS image bundles are re-zipped per extraction, so their content id says
 * whether a bundle changed; Android files are compared by their bytes.
 */
export async function getRelease(platform: Platform, id: string): Promise<ReleaseView> {
  const mine = (await releaseList()).filter((r) => r.platform === platform);
  const at = mine.findIndex((r) => r.id === id);
  const before = at >= 0 ? mine[at + 1] : undefined;
  const [release, previous, slugs] = await Promise.all([
    mustRelease(platform, id),
    before ? mustRelease(platform, before.id) : null,
    sourceSlugs(),
  ]);
  const now = release.sources;
  const was = previous?.sources ?? {};
  const same = (a: { sha: string; cid?: string }, b: { sha: string; cid?: string }): boolean =>
    a.cid !== undefined && b.cid !== undefined ? a.cid === b.cid : a.sha === b.sha;
  const keysOf = (r: Record<string, unknown>): string[] => Object.keys(r).sort();
  return {
    release,
    previous: previous && { id: previous.id, version: previous.version },
    added: previous ? keysOf(now).filter((k) => !(k in was)).map((k) => ({ source: k, to: now[k]?.version })) : [],
    removed: keysOf(was).filter((k) => !(k in now)).map((k) => ({ source: k, from: was[k]?.version })),
    changed: keysOf(now).flatMap((k) => {
      const a = was[k], b = now[k];
      return a && b && !same(a, b) ? [{ source: k, from: a.version, to: b.version }] : [];
    }),
    linked: keysOf(now).filter((k) => k in slugs),
  };
}
