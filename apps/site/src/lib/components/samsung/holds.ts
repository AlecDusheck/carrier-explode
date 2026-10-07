/** Which of a Samsung version's tabs it has something for, with the counts of what it holds. */

import { getSamsung } from "#lib/api/samsung.remote.ts";
import { verArgs } from "#lib/format.ts";
import type { At } from "#lib/types.ts";
import type { Holds } from "../views.ts";

export async function samsungHolds(at: At): Promise<Holds> {
	const v = await getSamsung(verArgs(at));
	return {
		settings: v.counts.settings,
		apns: v.counts.apns,
		files: v.counts.files,
		changes: v.previous !== null,
	};
}
