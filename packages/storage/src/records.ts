/** valibot schemas for the stored records this package defines; each `satisfies` its type, so drift fails to compile. */

import * as v from "valibot";

import { sha1Schema } from "@carrier-explode/schema/records";
import { ARTIFACT_KINDS, type ObjMeta, type OtaManifestPointer } from "./keys.ts";
import { SCAN_FORMAT, type ScanPointer } from "./scan.ts";

const str = v.string();

const origin = v.variant("kind", [
  v.object({ kind: v.literal("download"), url: str }),
  v.object({ kind: v.literal("image"), release: str, device: str, path: str }),
]);
const stored = { sha: str, size: v.number(), storedAt: str, origin };

export const objMetaSchema = v.variant("kind", [
  v.object({ ...stored, kind: v.literal("apple.ipcc"), cid: str }),
  v.object({ ...stored, kind: v.picklist(ARTIFACT_KINDS.filter((k) => k !== "apple.ipcc")) }),
]) satisfies v.GenericSchema<unknown, ObjMeta>;

export const scanPointerSchema = v.object({
  format: v.literal(SCAN_FORMAT),
  gen: str,
  builtAt: str,
  sources: v.number(),
  previous: v.nullable(str),
  heads: str,
  complete: v.boolean(),
}) satisfies v.GenericSchema<unknown, ScanPointer>;

/** feeds/apple-ota/manifests/current.json. */
export const manifestPointerSchema = v.object({
  sha1: sha1Schema,
}) satisfies v.GenericSchema<unknown, OtaManifestPointer>;

