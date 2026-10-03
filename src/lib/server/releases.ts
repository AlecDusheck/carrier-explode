/**
 * OS releases: an iOS build or a Pixel build, and what its image carries for
 * each source (releases/<platform>/<id>.json, written by the extractor).
 */

import { error } from "@sveltejs/kit";
import * as v from "valibot";
import { keys } from "#lib/storage/keys.ts";
import type { Platform, Release, ReleaseSource } from "#lib/schema/types.ts";
import type { ReleaseSummary } from "#lib/storage/keys.ts";
import type { Kind } from "#lib/types.ts";
import { perRequest } from "./cache";
import { pageFor, releaseList } from "./catalog";
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
  /** Where each listed source's page is; a source missing here is not indexed yet. */
  readonly pages: Readonly<Record<string, { readonly kind: Kind; readonly name: string }>>;
}

/**
 * What identifies a source's content in a release, across its device groups:
 * iOS image bundles are re-zipped per extraction, so their content id; Android
 * files by their bytes.
 */
const contentOf = (files: readonly ReleaseSource[]): string =>
  files.map((f) => f.cid ?? f.sha).sort().join(",");

/** The newest version a release carries for a source (Android device groups can differ). */
const versionIn = (files: readonly ReleaseSource[] | undefined): string | undefined =>
  files?.map((f) => f.version).sort().at(-1);

/** Sources added, removed and changed against the platform's previous release. */
export async function getRelease(platform: Platform, id: string): Promise<ReleaseView> {
  const mine = (await releaseList()).filter((r) => r.platform === platform);
  const at = mine.findIndex((r) => r.id === id);
  const before = at >= 0 ? mine[at + 1] : undefined;
  const [release, previous] = await Promise.all([mustRelease(platform, id), before ? mustRelease(platform, before.id) : null]);
  const now = release.sources;
  const was = previous?.sources ?? {};
  const keysOf = (r: Record<string, unknown>): string[] => Object.keys(r).sort();
  const listed = [...new Set([...keysOf(now), ...keysOf(was)])];
  const pages = Object.fromEntries((await Promise.all(listed.map(async (k) => [k, await pageFor(k)] as const))).flatMap(([k, p]) => (p ? [[k, p]] : [])));
  return {
    release,
    previous: previous && { id: previous.id, version: previous.version },
    added: previous ? keysOf(now).filter((k) => !(k in was)).map((k) => ({ source: k, to: versionIn(now[k]) })) : [],
    removed: keysOf(was).filter((k) => !(k in now)).map((k) => ({ source: k, from: versionIn(was[k]) })),
    changed: keysOf(now).flatMap((k) => {
      const a = was[k], b = now[k];
      return a && b && contentOf(a) !== contentOf(b) ? [{ source: k, from: versionIn(a), to: versionIn(b) }] : [];
    }),
    pages,
  };
}

/** Every Android build, newest first: the Builds page's second table. */
export async function androidBuilds(): Promise<ReleaseSummary[]> {
  return (await releaseList()).filter((r) => r.platform === "android");
}
