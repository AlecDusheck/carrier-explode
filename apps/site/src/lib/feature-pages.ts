/** The feature pages: one per state concept, named and described by the schema. */

import {
	FEATURE_SLUGS,
	RELEASE_PLATFORMS,
	conceptById,
	decoderFamily,
	expresses,
	featureWhere,
	type FeatureSlug,
	type ReleasePlatform,
} from "@carrier-explode/schema";
import type { Defaulted, DefaultLayer } from "@carrier-explode/schema/types";
import { PLATFORM_DEVICES } from "./platforms";

/** `iPhone, Pixel and Galaxy`, or with `or`. */
export const deviceWords = (platforms: readonly ReleasePlatform[], conjunction: "and" | "or"): string => {
	const words = platforms.map((p) => PLATFORM_DEVICES[p]);
	const last = words.at(-1);
	return words.length < 2 || last === undefined
		? (last ?? "")
		: `${words.slice(0, -1).join(", ")} ${conjunction} ${last}`;
};

export interface FeaturePage {
	readonly slug: FeatureSlug;
	readonly name: string;
	/** One sentence a non-expert understands. */
	readonly what: string;
	/** Where a phone's switch for it is, by the phone's platform. */
	readonly where: Readonly<Partial<Record<ReleasePlatform, string>>>;
	/** The phones' platforms whose settings can express it. */
	readonly platforms: readonly ReleasePlatform[];
}

export const FEATURE_PAGES: readonly FeaturePage[] = FEATURE_SLUGS.map((slug) => {
	const c = conceptById(slug);
	return {
		slug,
		name: c?.name ?? slug,
		what: c?.description ?? "",
		where: Object.fromEntries(
			RELEASE_PLATFORMS.flatMap((p) => {
				const where = featureWhere(p, slug);
				return where === undefined ? [] : [[p, where]];
			}),
		),
		platforms: RELEASE_PLATFORMS.filter((p) => expresses(decoderFamily(p), slug)),
	};
});

export const featurePage = (slug: string): FeaturePage | undefined =>
	FEATURE_PAGES.find((f) => f.slug === slug);

const LAYER_WORDS = {
	"default.pb": { label: "build default", by: "the phone's build default (default.pb)" },
	aosp: { label: "Android default", by: "Android's own default" },
	imsservice: { label: "IMS default", by: "the IMS service's default" },
} as const satisfies Record<DefaultLayer, { label: string; by: string }>;

/** A layer's say in a state: a badge only when it decided the whole state; when the carrier set part of it, a hint alone. */
export type DefaultNote =
	| { readonly kind: "badge"; readonly label: string; readonly hint: string }
	| { readonly kind: "hint"; readonly hint: string };

export function defaultNote(d: Defaulted): DefaultNote {
	const { label, by } = LAYER_WORDS[d.layer];
	return d.part === "all"
		? { kind: "badge", label, hint: `The carrier leaves it unset: ${by} decides` }
		: { kind: "hint", hint: `The carrier sets part of it: ${by} decides the rest` };
}
