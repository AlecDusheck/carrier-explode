/** OS releases (releases/<platform>/<id>.json): what an iPhone or Pixel build carries for each source. */

import { error } from "@sveltejs/kit";
import { keys } from "@carrier-explode/storage";
import { changesOf } from "@carrier-explode/db/d1";
import {
  lineOf, sourceOf, versionPath, type AppleRelease, type ImageModem, type Release, type ReleaseChange, type ReleasedEntry, type ReleasePlatform, type ReleaseSummary, type SourceKey,
} from "@carrier-explode/schema";
import { releaseSchema } from "@carrier-explode/schema/records";
import type { Picture } from "#lib/types.ts";
import { perRequest } from "./cache";
import { isIndexed, locate, releaseList } from "./catalog";
import { db } from "./db";
import { pictureOf } from "./pictures";
import { readJson } from "./store";

const releaseOf = perRequest((platform: ReleasePlatform, id: string) => readJson(keys.release(platform, id), releaseSchema));

type ReleaseOf<P extends ReleasePlatform> = Extract<Release, { readonly platform: P }>;

const isOf = <P extends ReleasePlatform>(r: Release, platform: P): r is ReleaseOf<P> => r.platform === platform;

export async function mustRelease<P extends ReleasePlatform>(platform: P, id: string): Promise<ReleaseOf<P>> {
  const r = await releaseOf(platform, id);
  if (!r) error(404, `No ${platform} release ${id}.`);
  if (!isOf(r, platform)) error(500, `releases/${platform}/${id}.json holds an ${r.platform} release`);
  return r;
}

/** An iOS build and its modem packages. */
export async function releaseModems(id: string): Promise<{ release: AppleRelease; modems: readonly ImageModem[] }> {
  const release = await mustRelease("ios", id);
  return { release, modems: release.modems };
}

/** A source's version in one release, linked to that version's page when the index has the source. */
export interface ReleasedVersion {
  readonly version: string;
  readonly path: string | null;
}

export interface SourceChange {
  readonly source: SourceKey;
  readonly picture: Picture | null;
  readonly from: ReleasedVersion | null;
  readonly to: ReleasedVersion | null;
}

export interface ReleaseView {
  readonly release: ReleaseSummary;
  readonly previous: ReleaseSummary | null;
  readonly added: readonly SourceChange[];
  readonly removed: readonly SourceChange[];
  readonly changed: readonly SourceChange[];
}

/** The version of an Apple source on its main line that an iOS build shipped; null when the index has none. */
export async function shippedVersion(build: string, key: SourceKey): Promise<ReleasedVersion | null> {
  if (!(await isIndexed(key))) return null;
  const { ref, timeline } = await locate(key);
  const entry = lineOf(timeline, null).find((e) => e.copies.some((c) => c.kind === "image" && c.releases.includes(build)));
  return entry === undefined ? null : { version: entry.version, path: versionPath(ref, { line: null, slug: entry.slug }) };
}

/** A build: what it added, removed and changed against its platform's previous release. */
export async function getRelease(platform: ReleasePlatform, id: string): Promise<ReleaseView> {
  const mine = (await releaseList()).filter((r) => r.platform === platform);
  const release = mine.find((r) => r.id === id);
  if (!release) error(404, `No ${platform} release ${id}.`);
  const rows = await changesOf(await db(), platform, id);
  const changes = rows.map(({ change, carrier }) => {
    const ref = sourceOf(change.source);
    const shown = (e: ReleasedEntry): ReleasedVersion => ({ version: e.version, path: carrier === null ? null : versionPath(ref, e) });
    return {
      kind: change.kind,
      view: {
        source: change.source,
        picture: carrier === null ? null : pictureOf(ref, carrier),
        from: change.kind === "added" ? null : shown(change.from),
        to: change.kind === "removed" ? null : shown(change.to),
      },
    };
  });
  const of = (kind: ReleaseChange["kind"]): SourceChange[] => changes.filter((c) => c.kind === kind).map((c) => c.view);
  return { release, previous: mine[mine.indexOf(release) + 1] ?? null, added: of("added"), removed: of("removed"), changed: of("changed") };
}
