/** Which of an Apple bundle's tabs this version has something for, with the counts of what it holds. */

import { getAppleBundle } from "#lib/api/apple.remote.ts";
import { isPri } from "#lib/apple/phones.ts";
import { verArgs } from "#lib/format.ts";
import { leafCount } from "#lib/settings.ts";
import type { At } from "#lib/types.ts";
import type { Holds } from "../../views.ts";

export async function appleHolds(at: At): Promise<Holds> {
	const bundle = await getAppleBundle(verArgs(at));
	const plist = bundle.quick["carrier.plist"];
	return {
		alerts:
			at.ref.kind === "country" && typeof plist === "object" && plist !== null && "CellBroadcast" in plist,
		settings: plist !== undefined && leafCount(plist),
		modem: at.ref.kind === "carrier" || bundle.info.files.some(isPri),
		files: bundle.info.files.length,
		changes: bundle.previous !== null,
	};
}
