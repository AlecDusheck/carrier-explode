/**
 * What every page of a source shows above its tabs: the version strip (the
 * versions of the line open: Apple's main line or a model's, an Android
 * device's), the one open, the source's other lines for the phone picker, and
 * the same carrier on the other platforms.
 */

import { error } from "@sveltejs/kit";
import type { SourceRef } from "#lib/schema/types.ts";
import type { Version } from "#lib/types.ts";
import { canonicalPath, counterparts, linesOf, resolveVer, versionsOf, type Ver } from "./catalog";
import { named } from "./devices";

export interface BundleHead {
  readonly ref: SourceRef;
  readonly line: string | undefined;
  /** The line's versions, newest first. */
  readonly timeline: readonly Version[];
  readonly entry: Version;
  readonly previous: Version | null;
  /** The version a device on a release runs now. */
  readonly head: string;
  /** The source's lines: Android's Pixels, newest first; Apple's model-specific bundles. */
  readonly lines: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** Where this content's page is canonical: the newest Pixel carrying the same file. */
  readonly canonical: string;
  readonly others: readonly SourceRef[];
}

export async function getHead(v: Ver): Promise<BundleHead> {
  const r = await resolveVer(v);
  const timeline = await versionsOf(r.ref.platform, r.entries);
  const find = (s: string | undefined): Version | undefined => timeline.find((e) => e.slug === s);
  const entry = find(r.entry.slug);
  if (!entry) error(500, `${r.key}: ${r.entry.slug} is not on its own line`);
  return {
    ref: r.ref,
    line: r.line,
    timeline,
    entry,
    previous: find(r.previous?.slug) ?? null,
    head: r.head.slug,
    lines: named(r.ref.platform, linesOf(r.timeline)),
    canonical: canonicalPath(r),
    others: counterparts(r),
  };
}
