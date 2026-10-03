/**
 * A page's version strip: every version of its iOS line, then every version of
 * its Android line, the one open, the one before it on its own line, and each
 * line's head. Plus, on Android, the Pixels the open version's release splits
 * into, for the phone picker.
 */

import { error } from "@sveltejs/kit";
import { byPixelRank, pixelName } from "#lib/schema/index.ts";
import { PLATFORMS, type Platform } from "#lib/schema/types.ts";
import type { Kind, Version } from "#lib/types.ts";
import { homePlatform, lineOf, pageOf, resolve, versionsOf } from "./catalog";

/** A group of Pixels that read one file in a release, and the version that file is. */
export interface DeviceGroupView {
  readonly slug: string;
  readonly phones: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export interface Strip {
  /** The open version's platform. */
  readonly platform: Platform;
  /** The page's iOS versions, then its Android ones, each line newest first. */
  readonly timeline: readonly Version[];
  readonly entry: Version;
  readonly previous: Version | null;
  /** Each line's head: what phones on a release run now. The first is the page's own head. */
  readonly heads: readonly string[];
  /** Android: the Pixel groups of the open version's release; empty on iOS. */
  readonly devices: readonly DeviceGroupView[];
}

export async function getStrip(kind: Kind, name: string, slug?: string): Promise<Strip> {
  const page = await pageOf(kind, name);
  const open = lineOf(page, slug);
  const home = homePlatform(page);
  const lines = await Promise.all(PLATFORMS.flatMap((p) => {
    const source = page.lines[p];
    return source ? [resolve(source, p === open.platform ? slug : undefined).then(async (r) => ({ p, r, versions: await versionsOf(p, r.timeline) }))] : [];
  }));
  const mine = lines.find((l) => l.p === open.platform);
  const find = (slugWanted: string | undefined): Version | undefined => mine?.versions.find((e) => e.slug === slugWanted);
  const entry = find(mine?.r.entry.slug);
  if (!mine || !entry) error(500, `${name}: the open version is not on its own line`);
  // The open version's release, split into the groups of Pixels that read one file each.
  const release = entry.releases.at(-1);
  const groups = entry.devices && release !== undefined ? mine.r.timeline.filter((e) => e.devices && e.releases.includes(release)) : [];
  return {
    platform: open.platform,
    timeline: lines.flatMap((l) => l.versions),
    entry,
    previous: find(mine.r.previous?.slug) ?? null,
    heads: [...lines].sort((a, b) => Number(b.p === home) - Number(a.p === home)).map((l) => l.r.head.slug),
    devices: groups.map((e) => ({ slug: e.slug, phones: [...(e.devices ?? [])].sort(byPixelRank).map((id) => ({ id, name: pixelName(id) })) })),
  };
}
