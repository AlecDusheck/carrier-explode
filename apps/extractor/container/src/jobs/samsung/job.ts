/**
 * galaxy.ap: the IMS operator of each of a Galaxy firmware's sales codes, from the IMS service in its AP member's system
 * partition. A container's: the AP member is deflated, so the partition is reached by streaming most of it to disk.
 */

import * as v from "valibot";

import { decodeOmcInfo, imsOperator, readIms } from "@carrier-explode/decode-samsung";
import { openGalaxyFirmware } from "../../../../src/galaxy/firmware.ts";
import { apParamsSchema } from "../../../../src/galaxy/ap.ts";
import type { JobRunner } from "../../job.ts";
import { imsMaps } from "./ap.ts";

export const galaxyAp: JobRunner = async (params, ctx) => {
	const { infos, ...ref } = v.parse(apParamsSchema, params);
	ctx.log(`${ref.model} ${ref.region} ${ref.build}: ${Object.keys(infos).length} sales codes`);
	const { firmware } = await openGalaxyFirmware(ref);
	const maps = readIms(await imsMaps(firmware, ctx.tmp));
	return Object.fromEntries(
		Object.entries(infos).map(([code, info]) => [code, imsOperator(decodeOmcInfo(info), maps)]),
	);
};
