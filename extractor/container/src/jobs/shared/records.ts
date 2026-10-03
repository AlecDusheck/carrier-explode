/**
 * valibot schemas for the R2 records the derived jobs read back. Every read
 * is validated: a record written by an older extractor, or by hand, fails here
 * with its key in the message instead of deep inside a mapper.
 *
 * Each schema `satisfies` its contract type, so a change to
 * src/lib/schema/types.ts or src/lib/storage/keys.ts that the schema misses
 * fails to compile.
 */

import * as v from "valibot";

import { PLATFORMS, PROFILE_SCHEMA, SOURCE_KINDS, type Profile, type Release, type TimelineEntry } from "../../../../../src/lib/schema/index.ts";
import type { ArtifactKind, ObjMeta, OtaRef } from "../../../../../src/lib/storage/keys.ts";
import type { ScanPointer } from "../../../../../src/lib/storage/scan.ts";
import { jsonSchema } from "../../../../src/jobs.ts";
import type { R2Client } from "../../job.ts";

const str = v.string();
const opt = <S extends v.GenericSchema>(s: S) => v.exactOptional(s);

const ARTIFACT_KINDS = [
  "ios.ipcc", "ios.bbfw", "ios.ftab", "android.carrier_settings", "android.carrier_list", "ios.ota-manifest",
] as const satisfies readonly ArtifactKind[];

export const objMetaSchema = v.object({
  sha256: str,
  size: v.number(),
  kind: v.picklist(ARTIFACT_KINDS),
  cid: opt(str),
  sha1: opt(str),
  sha384: opt(str),
  origin: v.object({ url: opt(str), release: opt(str), path: opt(str), device: opt(str) }),
  storedAt: str,
}) satisfies v.GenericSchema<unknown, ObjMeta>;

export const otaRefSchema = v.object({
  url: str,
  source: str,
  os: str,
  build: str,
  productType: opt(str),
  sha1: opt(str),
  sha384: opt(str),
  sha: opt(str),
  cid: opt(str),
  firstSeen: str,
  lastSeen: str,
  live: v.boolean(),
  error: opt(str),
}) satisfies v.GenericSchema<unknown, OtaRef>;

export const otaRefsSchema = v.array(otaRefSchema);

export const releaseSchema = v.object({
  platform: v.picklist(PLATFORMS),
  id: str,
  version: str,
  patch: opt(str),
  released: opt(str),
  prerelease: opt(v.boolean()),
  devices: v.array(str),
  extractedAt: str,
  sources: v.record(str, v.array(v.object({ sha: str, version: str, size: v.number(), cid: opt(str), devices: opt(v.array(str)) }))),
  carrierList: opt(str),
  modems: opt(v.array(v.unknown())),
}) satisfies v.GenericSchema<unknown, Release>;

const sourceRefSchema = v.object({ platform: v.picklist(PLATFORMS), kind: v.picklist(SOURCE_KINDS), name: str });

const simMatcherSchema = v.object({
  mccmnc: str, gid1: opt(str), gid2: opt(str), spn: opt(str), imsiPrefix: opt(str), iccidPrefix: opt(str),
});

const APN_TYPES = [
  "default", "mms", "supl", "dun", "hipri", "fota", "ims", "cbs", "ia", "emergency",
  "xcap", "ut", "rcs", "vsim", "bip", "enterprise", "all",
] as const;
const IP_PROTOCOLS = ["ip", "ipv6", "ipv4v6", "ppp"] as const;

const apnSchema = v.object({
  apn: str,
  label: opt(str),
  types: v.array(v.picklist(APN_TYPES)),
  protocol: opt(v.picklist(IP_PROTOCOLS)),
  roamingProtocol: opt(v.picklist(IP_PROTOCOLS)),
  auth: opt(v.picklist(["none", "pap", "chap", "pap_or_chap"])),
  user: opt(str),
  hasPassword: opt(v.boolean()),
  proxy: opt(str),
  port: opt(str),
  mmsc: opt(str),
  mmsProxy: opt(str),
  mmsPort: opt(str),
  mtu: opt(v.number()),
  bearers: opt(v.array(str)),
  path: str,
});

const conceptValueSchema = v.object({
  value: jsonSchema,
  state: opt(v.picklist(["on", "available", "no"])),
  because: v.array(v.object({ path: str, value: jsonSchema })),
  fidelity: opt(v.picklist(["exact", "derived", "approx"])),
});

export const profileSchema = v.object({
  schema: v.literal(PROFILE_SCHEMA),
  source: sourceRefSchema,
  sha: str,
  version: str,
  identity: v.object({ display: opt(str), iso: v.array(str), sims: v.array(simMatcherSchema) }),
  apns: v.array(apnSchema),
  concepts: v.record(str, conceptValueSchema),
  raw: v.record(str, jsonSchema),
  variants: v.array(v.object({
    id: str,
    label: str,
    when: v.object({ sims: opt(v.array(simMatcherSchema)), devices: opt(v.array(str)) }),
    concepts: v.record(str, conceptValueSchema),
    apns: opt(v.array(apnSchema)),
  })),
}) satisfies v.GenericSchema<unknown, Profile>;

const timelineCopySchema = v.variant("via", [
  v.object({ via: v.literal("image"), releases: v.array(str), sha: str, cid: opt(str) }),
  v.object({ via: v.literal("ota"), os: v.array(str), url: str, sha: opt(str), cid: opt(str), sha1: opt(str), sha384: opt(str) }),
]);

export const timelineEntrySchema = v.object({
  slug: str,
  version: str,
  copies: v.array(timelineCopySchema),
  devices: opt(v.array(str)),
  beta: v.boolean(),
  changed: v.boolean(),
}) satisfies v.GenericSchema<unknown, TimelineEntry>;

export const scanPointerSchema = v.object({
  format: v.literal(2),
  gen: str,
  builtAt: str,
  sources: v.number(),
  previous: opt(str),
  heads: opt(str),
}) satisfies v.GenericSchema<unknown, ScanPointer>;

/** A JSON record at `key` validated by `schema`; null when absent; throws with the key when malformed. */
export async function readRecord<S extends v.GenericSchema>(r2: R2Client, key: string, schema: S): Promise<v.InferOutput<S> | null> {
  const raw = await r2.getJson(key);
  if (raw === null) return null;
  const parsed = v.safeParse(schema, raw);
  if (!parsed.success) throw new Error(`${key}: ${v.summarize(parsed.issues)}`);
  return parsed.output;
}
