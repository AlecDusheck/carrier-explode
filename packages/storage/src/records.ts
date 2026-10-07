/** valibot schemas for the stored records this package defines. */

import * as v from "valibot";

import { sha1Schema } from "@carrier-explode/schema/records";

/** ota/<feed>/current.json: the snapshot a feed was last planned from. */
export const otaPointerSchema = v.object({ sha1: sha1Schema });
export type OtaPointer = v.InferOutput<typeof otaPointerSchema>;
