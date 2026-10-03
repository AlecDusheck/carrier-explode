/**
 * What every page of a source shows above its tabs: the version strip (the
 * source's own versions), the one open, and the same carrier on the other
 * platforms. Plus the device groups of the open version's release: an Android
 * build ships one file per group of Pixels, each its own timeline entry.
 */

import { error } from "@sveltejs/kit";
import type { SourceRef } from "#lib/schema/types.ts";
import type { Version } from "#lib/types.ts";
import { counterparts, resolve, versionsOf } from "./catalog";
import { named } from "./devices";

/** A group of devices that read one file in a release, and the version that file is. */
export interface DeviceGroup {
  readonly slug: string;
  readonly phones: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export interface BundleHead {
  readonly ref: SourceRef;
  readonly timeline: readonly Version[];
  readonly entry: Version;
  readonly previous: Version | null;
  /** The version a device on a release runs now. */
  readonly head: string;
  readonly others: readonly SourceRef[];
  /** The open version's release, split by the devices each file is for; empty when one file serves every device. */
  readonly groups: readonly DeviceGroup[];
}

const imageReleases = (e: { readonly copies: Version["copies"] }): string[] =>
  e.copies.flatMap((c) => (c.via === "image" ? c.releases : []));

export async function getHead(key: string, slug?: string): Promise<BundleHead> {
  const r = await resolve(key, slug);
  const timeline = await versionsOf(r.ref.platform, r.timeline);
  const find = (s: string | undefined): Version | undefined => timeline.find((e) => e.slug === s);
  const entry = find(r.entry.slug);
  if (!entry) error(500, `${key}: ${r.entry.slug} is not in its own timeline`);
  const release = imageReleases(entry).at(-1);
  const siblings = entry.devices && release !== undefined ? timeline.filter((e) => e.devices && imageReleases(e).includes(release)) : [];
  return {
    ref: r.ref,
    timeline,
    entry,
    previous: find(r.previous?.slug) ?? null,
    head: r.head.slug,
    others: counterparts(r),
    groups: siblings.map((e) => ({ slug: e.slug, phones: named(r.ref.platform, e.devices ?? []) })),
  };
}
