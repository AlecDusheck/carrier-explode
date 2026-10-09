/** Devices grouped into phones, each told from its siblings by what the index knows of it. */

import { deviceCoverage } from "@carrier-explode/db";
import { phonesOf, type DeviceCoverage, type NamedDevice } from "@carrier-explode/schema";
import type { Platform, ReleasePlatform } from "@carrier-explode/schema/types";
import type { ModelChoice } from "#lib/phones.ts";
import { cached, perRequest } from "./cache";
import { db, indexVersion } from "./db";

const coverageOf = perRequest(async (platform: ReleasePlatform): Promise<DeviceCoverage[]> =>
	cached(`coverage:v1:${platform}:${await indexVersion()}`, async () => deviceCoverage(await db(), platform)),
);

/** `devices`, a release platform's, as phones in their order, labelled by `label` and pictured as `shownAs`'s. */
export async function modelChoices(
	platform: ReleasePlatform,
	devices: readonly NamedDevice[],
	label: (name: string) => string,
	shownAs: Platform,
): Promise<ModelChoice[]> {
	return phonesOf(platform, devices, await coverageOf(platform)).map((p) =>
		Object.assign(p, { platform: shownAs, label: label(p.name) }),
	);
}
