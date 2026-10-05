/** What every page of a source shows above its tabs: its picture, the open line's version strip and its other lines. */

import { error } from "@sveltejs/kit";
import { linesOf } from "@carrier-explode/schema";
import type { Platform, SourceRef, Timeline } from "@carrier-explode/schema/types";
import { PLATFORM_DEVICES } from "#lib/platforms.ts";
import type { Picture, Version } from "#lib/types.ts";
import { canonicalPath, resolve, versionsOf } from "./catalog";
import type { Ver } from "#lib/types.ts";
import { namer } from "./names";
import { pictureOf } from "./pictures";

export interface SourceHead {
  readonly ref: SourceRef;
  readonly picture: Picture;
  /** The carrier's country, when the index knows it. */
  readonly cc: string | null;
  readonly line: string | null;
  /** The line's versions, newest first. */
  readonly timeline: readonly Version[];
  readonly entry: Version;
  readonly previous: Version | null;
  /** The line's newest non-beta version. */
  readonly head: string;
  /** The lines to choose between: Android's Pixels, newest first; Apple's main line (null) and its model-specific ones. None when there is no choice. */
  readonly lines: ReadonlyArray<{ readonly id: string | null; readonly name: string }>;
  /** Where this content's page is canonical: the newest Pixel carrying the same file. */
  readonly canonical: string;
}

async function choosableLines(platform: Platform, timeline: Timeline): Promise<SourceHead["lines"]> {
  // Every line but Apple's main one is a device's, in the order the index gave the timeline.
  const ids = linesOf(timeline);
  const devices = ids.flatMap((id) => (id === null ? [] : [id]));
  const device = await namer("device", devices);
  const lines = [...(ids.includes(null) ? [{ id: null, name: PLATFORM_DEVICES[platform] }] : []), ...devices.map((id) => ({ id, name: device(id).name }))];
  // The default line alone is no choice.
  return lines.length === 1 && lines[0]?.id === null ? [] : lines;
}

export async function getHead(v: Ver): Promise<SourceHead> {
  const r = await resolve(v);
  const [timeline, lines] = await Promise.all([versionsOf(r.ref.platform, r.entries), choosableLines(r.ref.platform, r.timeline)]);
  const find = (s: string | undefined): Version | undefined => timeline.find((e) => e.slug === s);
  const entry = find(r.entry.slug);
  if (!entry) error(500, `${r.key}: ${r.entry.slug} is not on its own line`);
  return {
    ref: r.ref,
    picture: pictureOf(r.ref, { ...r.carrier, iso: r.carrier.iso ?? null }),
    cc: r.carrier.iso ?? null,
    line: r.line,
    timeline,
    entry,
    previous: find(r.previous?.slug) ?? null,
    head: r.latest.slug,
    lines,
    canonical: canonicalPath(r),
  };
}
