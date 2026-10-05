/** valibot schemas for the values records are made of; each `satisfies` its type, so drift fails to compile. */

import * as v from "valibot";

import { DECODER_FAMILIES, isSourceKey, MODEM_KINDS, type Device, type ImageModem, type Json, type SourceKey } from "../types.ts";

const str = v.string();
/** How artifacts are named: lower-case hex SHA-256. */
export const sha256Schema = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/, "expected a lower-case sha256"));
/** Apple's manifest digests and Shannon's file names: lower-case hex SHA-1. */
export const sha1Schema = v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/, "expected a lower-case sha1"));
const count = v.pipe(v.number(), v.integer(), v.minValue(0));

export const jsonSchema: v.GenericSchema<Json> = v.lazy(() =>
  v.union([v.null(), v.boolean(), v.number(), v.string(), v.array(jsonSchema), v.record(v.string(), jsonSchema)]),
);

export const sourceKeySchema = v.custom<SourceKey>((s) => typeof s === "string" && isSourceKey(s), "expected a sourceKey");

export const imageModemSchema = v.object({
  family: str,
  devices: v.array(str),
  package: v.object({ kind: v.picklist(MODEM_KINDS), name: str, sha: sha256Schema, size: count, crc32: str }),
}) satisfies v.GenericSchema<unknown, ImageModem>;

export const deviceSchema = v.object({
  code: str,
  family: v.picklist(DECODER_FAMILIES),
  released: v.pipe(str, v.regex(/^\d{4}(-\d{2}){0,2}$/)),
  boards: v.pipe(v.array(str), v.readonly()),
}) satisfies v.GenericSchema<unknown, Device>;
