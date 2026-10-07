/** Two sources of different platforms, concept by concept: what /compare shows across platforms. */

import { error } from "@sveltejs/kit";
import {
	compareProfiles,
	phoneVariantId,
	profileFor,
	type Profile,
	type ProfileComparison,
	type SourceKey,
} from "@carrier-explode/schema";
import { resolve } from "./catalog";
import type { Side } from "./compare";
import { overridePlistOf } from "./apple/phones";
import { profileAt } from "./profiles";

export interface CrossComparison {
	readonly a: SourceKey;
	readonly b: SourceKey;
	readonly comparison: ProfileComparison;
}

/** A side's Profile as its phone sees it, when an Apple side names one by its override file. */
const seenBy = (p: Profile, variant: string | undefined): Profile =>
	variant === undefined ? p : profileFor(p, phoneVariantId(overridePlistOf(variant)));

/** Two versions of sources on different platforms, concept by concept. */
export async function getCrossComparison(a: Side, b: Side): Promise<CrossComparison> {
	const [ra, rb] = await Promise.all([resolve(a), resolve(b)]);
	const [pa, pb] = await Promise.all([profileAt(ra.entry), profileAt(rb.entry)]);
	if (!pa || !pb) error(404, `${!pa ? a.source : b.source} has no normalised settings at that version yet.`);
	return { a: ra.key, b: rb.key, comparison: compareProfiles(seenBy(pa, a.variant), seenBy(pb, b.variant)) };
}
