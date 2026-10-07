/** A version's normalized profile: the one place the site names which profile an entry is, in R2 and in D1. */

import { error } from "@sveltejs/kit";
import { selectedBy } from "@carrier-explode/db";
import type { Profile, TimelineEntry } from "@carrier-explode/schema";
import { profileSchema } from "@carrier-explode/schema/records";
import type { SourceKey } from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import { perRequest } from "./cache";
import { db } from "./db";
import { readJson } from "./store";

/** The id the index files an entry's profile rows under. */
const profileId = (e: Pick<TimelineEntry, "sha">): string => e.sha;

const profileOf = perRequest((id: string) => readJson(keys.norm(id), profileSchema));

/** An entry's profile; null when it has not been normalized yet. */
export const profileAt = (e: Pick<TimelineEntry, "sha">): Promise<Profile | null> => profileOf(profileId(e));

export async function mustProfile(e: Pick<TimelineEntry, "sha">): Promise<Profile> {
	const p = await profileAt(e);
	if (!p) error(500, `${keys.norm(profileId(e))} is not in the bucket.`);
	return p;
}

/** The SIM rules an entry's profile claims, and those Apple's OTA manifest routes to its source. */
export const rulesAt = async (
	e: Pick<TimelineEntry, "sha">,
	source: SourceKey,
): ReturnType<typeof selectedBy> => selectedBy(await db(), profileId(e), source);
