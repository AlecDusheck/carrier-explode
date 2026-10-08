/** What every page of a source shows above its tabs: its picture, the open line's version strip and its other lines. */

import { error } from "@sveltejs/kit";
import { compareVersions, isPrerelease } from "@carrier-explode/decode-ios";
import { linesOf } from "@carrier-explode/schema";
import { decoderFamily, MAIN_LINE, type DecoderFamily, type SourceRef } from "@carrier-explode/schema/types";
import { readAgainst } from "#lib/apple/phones.ts";
import { DEVICE_LINE_LABELS, PLATFORM_DEVICES } from "#lib/platforms.ts";
import type { Picture, Ver, Version } from "#lib/types.ts";
import {
	PHONE_IMAGES,
	canonicalPath,
	lineNames,
	releasesOf,
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
	/** The head when a device on the newest OS runs it; null on a line no current OS ships, such as an old model's. */
	readonly current: string | null;
	/** The lines to choose between: Android's Pixels, newest first; Apple's main line and its model-specific ones. None when there is no choice. `name` is the device's, which its drawing is found by. */
	readonly lines: ReadonlyArray<{ readonly id: string; readonly name: string; readonly label: string }>;
	/** Where this content's page is canonical: the newest Pixel carrying the same file. */
	readonly canonical: string;
}

/** Every line but Apple's main one is a device's. */
async function choosableLines(r: Resolved): Promise<SourceHead["lines"]> {
	const { platform } = r.ref;
	const ids = linesOf(r.ref, r.timeline, r.order);
	const names = await lineNames(platform);
	const lines = ids.map((id) => {
		if (id === MAIN_LINE)
			return { id, name: PLATFORM_DEVICES[platform], label: `${PLATFORM_DEVICES[platform]} (Modern)` };
		const name = names.get(id) ?? id;
		return { id, name, label: DEVICE_LINE_LABELS[decoderFamily(platform)](name) };
	});
	// The default line alone is no choice.
	return lines.length === 1 && lines[0]?.id === MAIN_LINE ? [] : lines;
}

/** The number an OTA listing's OS states (`27.0`, `Watch4` -> `4`); undefined for `legacy` or a prerelease. */
const listedOs = (os: string): string | undefined =>
	isPrerelease(os) ? undefined : /\d+(?:\.\d+)*/.exec(os)?.[0];

/**
 * Whether a device on the newest OS runs an Apple version: the newest public image carries it, or Apple's OTA
 * manifest lists it under the newest OS it lists the bundle for.
 */
async function appleCurrent(r: Resolved, head: Version): Promise<boolean> {
	const images = PHONE_IMAGES[r.ref.platform];
	const release = images ? readAgainst(await releasesOf(images)) : undefined;
	const newestOs = r.copies
		.flatMap((c) => (c.kind === "ota" ? c.os.flatMap((os) => listedOs(os) ?? []) : []))
		.toSorted(compareVersions)
		.at(-1);
	return head.copies.some((c) =>
		c.kind === "release"
			? release !== undefined && c.releases.includes(release.id)
			: c.os.some((os) => newestOs !== undefined && listedOs(os) === newestOs),
	);
}

/** Whether a family's head is what a device on the newest OS runs. */
const IS_CURRENT = {
	apple: appleCurrent,
	android: async () => true,
	samsung: async () => true,
} as const satisfies Record<DecoderFamily, (r: Resolved, head: Version) => Promise<boolean>>;

export async function getHead(v: Ver): Promise<SourceHead> {
	const r = await resolve(v);
	const [timeline, lines] = await Promise.all([versionsOf(r, r.entries), choosableLines(r)]);
	const find = (s: string | undefined): Version | undefined => timeline.find((e) => e.slug === s);
	const entry = find(r.entry.slug);
	if (!entry) error(500, `${r.key}: ${r.entry.slug} is not on its own line`);
	const head = find(r.latest.slug);
	const current = head && (await IS_CURRENT[decoderFamily(r.ref.platform)](r, head)) ? head.slug : null;
	return {
		ref: r.ref,
		picture: pictureOf(r.ref, r.source),
		brand: brandOf(r.ref, r.source.carrierName, r.source.cc),
		cc: r.source.cc,
		line: r.line,
		timeline,
		entry,
		previous: find(r.previous?.slug) ?? null,
		head: r.latest.slug,
		current,
		lines,
		canonical: canonicalPath(r),
	};
}
