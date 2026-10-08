/** How each platform, the device its settings are for, and its sources are named and pictured on a page. */

import { RARITY } from "@carrier-explode/schema";
import type { DecoderFamily, Platform } from "@carrier-explode/schema/types";

export const PLATFORM_NAMES = {
	ios: "iOS",
	ipados: "iPadOS",
	watchos: "watchOS",
	android: "Pixel",
	samsung: "Samsung",
} as const satisfies Record<Platform, string>;

export const PLATFORM_DEVICES = {
	ios: "iPhone",
	ipados: "iPad",
	watchos: "Apple Watch",
	android: "Pixel",
	samsung: "Galaxy",
} as const satisfies Record<Platform, string>;

/** How a device's own line reads beside its platform's main line: an Apple model's line is an old iPhone's OTA bundle, which the main line has replaced. */
export const DEVICE_LINE_LABELS = {
	apple: (name: string) => `${name} (Legacy)`,
	android: (name: string) => name,
	samsung: (name: string) => name,
} as const satisfies Record<DecoderFamily, (name: string) => string>;

/** Each platform's device as a plain outline in static/phones. */
export const PLATFORM_DRAWINGS = {
	ios: "phones/iphone.svg",
	ipados: "phones/ipad.svg",
	watchos: "phones/watch.svg",
	android: "phones/pixel.svg",
	// A plain outline: no Galaxy is measured, so none is drawn.
	samsung: "phones/galaxy.svg",
} as const satisfies Record<Platform, `phones/${string}.svg`>;

/** What a platform's pages say first, where the site's coverage of it is thin. */
export const PLATFORM_NOTICES = {
	ios: null,
	android: null,
	samsung: null,
	ipados:
		"Work in progress: carrier-explode doesn't have the best coverage on iPadOS yet… we're working on it!",
	watchos:
		"Work in progress: carrier-explode doesn't have the best coverage on watchOS yet… we're working on it!",
} as const satisfies Record<Platform, string | null>;

/** The phones first; iPad and Watch bundles are a few dozen each. */
export const PLATFORM_ORDER = [
	"ios",
	"android",
	"samsung",
	"ipados",
	"watchos",
] as const satisfies readonly Platform[];

/** A version's major release, as the site writes versions: "27" of "27.2 beta 2", "16" of "16 QPR2". */
const major = (version: string | undefined): string | undefined => version?.split(/[ .]/)[0];

/** Each release's mark, drawn after the vendor's version icons, by `./marks/<dir>/<major>.svg`; `<dir>.svg` is the plain tile. */
const MARKS = import.meta.glob<string>("./marks/*/*.svg", {
	eager: true,
	query: "?url&no-inline",
	import: "default",
});

/** The mark for a version's major in `dir`, else the plain tile. */
const markIn =
	(dir: "ios" | "android") =>
	(version: string | undefined): string => {
		const plain = MARKS[`./marks/${dir}/${dir}.svg`];
		if (plain === undefined) throw new Error(`marks/${dir}/${dir}.svg is missing`);
		return MARKS[`./marks/${dir}/${major(version) ?? dir}.svg`] ?? plain;
	};

/** A Galaxy's version is its Android release, so it takes Android's marks. */
const androidMark = markIn("android");
const appleMark = markIn("ios");

/** The mark beside a version of each platform, as a URL. */
export const VERSION_MARKS = {
	ios: appleMark,
	ipados: appleMark,
	watchos: appleMark,
	android: androidMark,
	samsung: androidMark,
} as const satisfies Record<Platform, (version: string | undefined) => string>;

/** What a family calls one of its sources, and the file a source's settings are read from. */
export const SOURCE_NOUNS = {
	apple: { one: "bundle", many: "bundles", settings: "carrier.plist" },
	android: { one: "source", many: "sources", settings: "CarrierConfig" },
	samsung: { one: "pack", many: "packs", settings: "customer.xml" },
} as const satisfies Record<
	DecoderFamily,
	{ readonly one: string; readonly many: string; readonly settings: string }
>;

/** The rare-settings section's heading and note: rare, not unique, as up to RARITY.maxSharers other sources may share a row. */
export function rareSection(
	family: DecoderFamily,
	rows: number,
): { readonly legend: string; readonly note: string } {
	const { many, settings } = SOURCE_NOUNS[family];
	return {
		legend: `Rare settings (${rows})`,
		note: `${settings} settings at most ${RARITY.maxSharers} other ${many} share.`,
	};
}
