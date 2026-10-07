/** What every page of a source shows above its tabs: its picture, the open line's version strip and its other lines. */

import { error } from "@sveltejs/kit";
import { linesOf } from "@carrier-explode/schema";
import { MAIN_LINE, type SourceRef } from "@carrier-explode/schema/types";
import { PLATFORM_DEVICES } from "#lib/platforms.ts";
import type { Picture, Ver, Version } from "#lib/types.ts";
import {
	canonicalPath,
	carrierOfSource,
	countryOf,
	lineNames,
	resolve,
	versionsOf,
	type Resolved,
} from "./catalog";
import { brandOf, pictureOf } from "./pictures";

export interface SourceHead {
	readonly ref: SourceRef;
	readonly picture: Picture;
	/** What people call it: `T-Mobile` for TMobile_US. */
	readonly brand: string;
	/** The carrier's country, or a country bundle's, when the index knows it. */
	readonly cc: string | null;
	readonly line: string;
	/** The line's versions, newest first. */
	readonly timeline: readonly Version[];
	readonly entry: Version;
	readonly previous: Version | null;
	/** The version shown when none is named: the line's newest release, else its newest beta. */
	readonly head: string;
	/** The lines to choose between: Android's Pixels, newest first; Apple's main line and its model-specific ones. None when there is no choice. */
	readonly lines: ReadonlyArray<{ readonly id: string; readonly name: string }>;
	/** Where this content's page is canonical: the newest Pixel carrying the same file. */
	readonly canonical: string;
}

/** Every line but Apple's main one is a device's. */
async function choosableLines(r: Resolved): Promise<SourceHead["lines"]> {
	const { platform } = r.ref;
	const ids = linesOf(r.ref, r.timeline, r.order);
	const names = await lineNames(platform);
	const lines = ids.map((id) => ({
		id,
		name: id === MAIN_LINE ? PLATFORM_DEVICES[platform] : (names.get(id) ?? id),
	}));
	// The default line alone is no choice.
	return lines.length === 1 && lines[0]?.id === MAIN_LINE ? [] : lines;
}

export async function getHead(v: Ver): Promise<SourceHead> {
	const r = await resolve(v);
	const [timeline, lines, carrier, cc] = await Promise.all([
		versionsOf(r, r.entries),
		choosableLines(r),
		carrierOfSource(r.key),
		countryOf(r.key),
	]);
	const find = (s: string | undefined): Version | undefined => timeline.find((e) => e.slug === s);
	const entry = find(r.entry.slug);
	if (!entry) error(500, `${r.key}: ${r.entry.slug} is not on its own line`);
	return {
		ref: r.ref,
		picture: pictureOf(r.ref, carrier, cc),
		brand: brandOf(r.ref, carrier?.name ?? null, cc),
		cc,
		line: r.line,
		timeline,
		entry,
		previous: find(r.previous?.slug) ?? null,
		head: r.latest.slug,
		lines,
		canonical: canonicalPath(r),
	};
}
