/** What every source's pages share: the lists, the source head, comparisons, rarity, the visitor guess, and the feature pages. */

import * as v from "valibot";
import { query } from "$app/server";
import { FEATURE_SLUGS } from "@carrier-explode/schema";
import { RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
import { carrierMembers } from "#lib/server/catalog.ts";
import { getComparison as compare } from "#lib/server/compare.ts";
import * as features from "#lib/server/features.ts";
import { getHead } from "#lib/server/head.ts";
import * as lists from "#lib/server/lists.ts";
import * as scan from "#lib/server/scan.ts";
import * as visitor from "#lib/server/visitor.ts";
import { iso, key, kind, path, phone, platform, ver, verSchema } from "./schemas";

export const getList = query(v.object({ platform, kind }), (a) => lists.getListRows(a.platform, a.kind));
export const getCountryCarriers = query(v.object({ platform, iso }), (a) =>
	lists.getCountryCarriers(a.platform, a.iso),
);
/** A platform's sources named only by a SIM rule, in one country when given. */
export const getRuleSources = query(v.object({ platform, iso: v.nullable(iso) }), (a) =>
	lists.getRuleSources(a.platform, a.iso),
);
/** A source as its list shows it; null when the index lacks it. Calls in one tick share one lookup. */
export const getListEntry = query.batch(key, async (keys) => {
	const entries = await lists.listEntries(keys);
	return (k) => entries.get(k) ?? null;
});
/** Every source of a source's carrier, on every platform, its primary bundle first. */
export const getCarrierMembers = query(key, async (k) => lists.chipEntries(await carrierMembers(k)));
/** Every source with its carrier's name: what Compare's boxes complete from. */
export const getSourceBrands = query(lists.allSourceBrands);
/** The platforms each kind of list has, as [kind, platforms] pairs. */
export const getListPlatforms = query(async () =>
	[...(await lists.listPlatforms())].map(([k, ps]) => [k, [...ps]] as const),
);
/** The visitor's best guess, from what their browser reports of their device. */
export const getVisitorGuess = query(
	v.object({ platform: v.nullable(platform), model: v.undefinedable(v.pipe(v.string(), v.maxLength(64))) }),
	visitor.visitorGuess,
);

/** The source head: the line's versions, the one open and the source's lines. */
export const getSourceHead = query(verSchema, getHead);

/** A side: a version, and the variant of it one phone sees (on Apple, that phone's override file). */
const side = v.object({ ...ver, variant: v.exactOptional(path) });

/** One diff for /compare and the Changes tabs; no `a` means the version before `b`. */
export const getComparison = query(
	v.object({ a: v.nullable(side), b: side, path: v.exactOptional(path) }),
	(q) => compare(q.a, q.b, q.path),
);

export const getRare = query(verSchema, scan.getRare);

export const getFeaturePhones = query(features.featurePhones);
/** The same phones grouped as the phone picker offers them. */
export const getFeatureModels = query(features.featureModels);
/** The phone `?phone=` names; any other text, like an unknown code, means the newest covered one the feature is on. */
export const getFeaturePhone = query(
	v.object({
		phone: v.optional(v.pipe(v.string(), v.maxLength(64))),
		slug: v.optional(v.picklist(FEATURE_SLUGS)),
	}),
	(a) => features.featurePhone(a.phone, a.slug),
);
export const getFeatureTable = query(v.object({ slug: v.picklist(FEATURE_SLUGS), phone }), (a) =>
	features.getFeatureTable(a.slug, a.phone),
);
export const getFeatureMatrix = query(phone, features.getFeatureMatrix);
/** A source head's features on the newest of `phones` with states, and the settings behind each in the Apple override `file` they read. */
export const getSourceFeatures = query(
	v.object({
		...ver,
		phones: v.pipe(v.array(v.pipe(v.string(), v.maxLength(64))), v.maxLength(32)),
		file: v.nullable(v.pipe(v.string(), v.maxLength(256))),
	}),
	(a) => features.getSourceFeatures(a, a.phones, a.file),
);
/** A country's carriers' features on a phone: `phone` names one, else the platform's newest. */
export const getCountryMatrix = query(
	v.object({
		platform: v.picklist(RELEASE_PLATFORMS),
		iso,
		phone: v.exactOptional(v.pipe(v.string(), v.maxLength(64))),
	}),
	(a) => features.getCountryMatrix(a.platform, a.iso, a.phone),
);
