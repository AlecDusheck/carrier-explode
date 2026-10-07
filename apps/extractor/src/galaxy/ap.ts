/** The galaxy.ap container job's contract: what the Worker asks of a firmware's AP member, and what the container answers. */

import * as v from "valibot";

import type { ImsOperator } from "@carrier-explode/decode-samsung";
import { jsonSchema } from "@carrier-explode/schema/records";

const str = v.pipe(v.string(), v.minLength(1));

/** The firmware FUS serves, and the omc.info of each sales code it finds the IMS operator of. */
export const apParamsSchema = v.object({
	model: str,
	region: str,
	version: str,
	build: str,
	infos: v.record(str, v.string()),
});
export type ApParams = v.InferOutput<typeof apParamsSchema>;

const imsRecord = v.record(v.string(), jsonSchema);
const imsOperatorSchema = v.object({
	mno: str,
	switches: imsRecord,
	profile: v.nullable(imsRecord),
	settings: imsRecord,
	defaults: v.object({ switches: imsRecord, settings: imsRecord }),
}) satisfies v.GenericSchema<unknown, ImsOperator>;

/** Each sales code's IMS operator, `null` for none. */
export const apOutputSchema = v.record(str, v.nullable(imsOperatorSchema));
