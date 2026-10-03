/** valibot schemas for the R2 records jobs read back; each `satisfies` its contract type, so drift fails to compile. */

import * as v from "valibot";

import {
  PLATFORMS, PROFILE_SCHEMA, SOURCE_KINDS,
  type AndroidRelease, type AppleRelease, type CarrierDoc, type Profile, type Release,
} from "../../../../../src/lib/schema/index.ts";
import type { ArtifactKind, CarrierSummary, ObjMeta, OtaRef } from "../../../../../src/lib/storage/keys.ts";
import type { ScanPointer } from "../../../../../src/lib/storage/scan.ts";
import { jsonSchema } from "../../../../src/jobs.ts";
import type { R2Client } from "../../job.ts";

const str = v.string();
const opt = <S extends v.GenericSchema>(s: S): v.ExactOptionalSchema<S, undefined> => v.exactOptional(s);

const ARTIFACT_KINDS = [
  "apple.ipcc", "apple.bbfw", "apple.ftab", "apple.ota-manifest", "android.carrier-settings", "android.carrier-list",
] as const satisfies readonly ArtifactKind[];

export const objMetaSchema = v.object({
  sha256: str,
  size: v.number(),
  kind: v.picklist(ARTIFACT_KINDS),
  cid: opt(str),
  origin: v.variant("via", [
    v.object({ via: v.literal("download"), url: str }),
    v.object({ via: v.literal("image"), release: str, device: str, path: str }),
  ]),
  storedAt: str,
}) satisfies v.GenericSchema<unknown, ObjMeta>;

const digestSchema = v.object({ algorithm: v.picklist(["sha1", "sha384"]), hex: str });

const archiveSchema = v.variant("state", [
  v.object({ state: v.literal("archived"), sha: str, cid: str }),
  v.object({ state: v.literal("pending") }),
  v.object({ state: v.literal("failed"), error: str }),
]);

export const otaRefsSchema = v.array(v.object({
  url: str,
  source: str,
  os: str,
  build: str,
  model: opt(str),
  published: opt(str),
  digest: opt(digestSchema),
  archive: archiveSchema,
  firstSeen: str,
  lastSeen: str,
  live: v.boolean(),
}) satisfies v.GenericSchema<unknown, OtaRef>);

const header = {
  id: str,
  version: str,
  released: opt(str),
  prerelease: v.boolean(),
  devices: v.array(str),
  extractedAt: str,
};
const artifact = { sha: str, version: str, size: v.number() };

const imageModemSchema = v.object({
  family: str,
  devices: v.array(str),
  package: v.object({ sha: str, size: v.number(), name: str, crc32: str, kind: v.picklist(["bbfw", "ftab"]) }),
});

const appleReleaseSchema = v.object({
  ...header,
  platform: v.picklist(["ios", "ipados", "watchos"]),
  sources: v.record(str, v.object({ ...artifact, cid: str })),
  modems: v.array(imageModemSchema),
}) satisfies v.GenericSchema<unknown, AppleRelease>;

const androidReleaseSchema = v.object({
  ...header,
  platform: v.literal("android"),
  patch: str,
  sources: v.record(str, v.array(v.object({ ...artifact, devices: v.array(str) }))),
  carrierList: str,
}) satisfies v.GenericSchema<unknown, AndroidRelease>;

export const releaseSchema = v.variant("platform", [appleReleaseSchema, androidReleaseSchema]) satisfies v.GenericSchema<unknown, Release>;

const sourceRefSchema = v.object({ platform: v.picklist(PLATFORMS), kind: v.picklist(SOURCE_KINDS), name: str });

const simMatcherSchema = v.object({
  mccmnc: str, gid1: opt(str), gid2: opt(str), spn: opt(str), imsiPrefix: opt(str), iccidPrefix: opt(str),
});

const IP_PROTOCOLS = ["ip", "ipv6", "ipv4v6", "ppp"] as const;

const apnSchema = v.object({
  apn: str,
  label: opt(str),
  types: v.array(v.picklist([
    "default", "mms", "supl", "dun", "hipri", "fota", "ims", "cbs", "ia", "emergency",
    "xcap", "ut", "rcs", "vsim", "bip", "enterprise", "all",
  ])),
  protocol: opt(v.picklist(IP_PROTOCOLS)),
  roamingProtocol: opt(v.picklist(IP_PROTOCOLS)),
  auth: opt(v.picklist(["none", "pap", "chap", "pap_or_chap"])),
  user: opt(str),
  hasPassword: v.boolean(),
  proxy: opt(str),
  port: opt(str),
  mmsc: opt(str),
  mmsProxy: opt(str),
  mmsPort: opt(str),
  mtu: opt(v.number()),
  bearers: opt(v.array(str)),
  path: str,
});

const nativeRefs = v.array(v.object({ path: str, value: jsonSchema }));
const fidelity = v.picklist(["exact", "derived", "approx"]);

const conceptValueSchema = v.variant("kind", [
  v.object({ kind: v.literal("state"), state: v.picklist(["on", "available", "no"]), because: nativeRefs, fidelity }),
  v.object({ kind: v.literal("value"), value: jsonSchema, because: nativeRefs, fidelity }),
  v.object({ kind: v.literal("unset") }),
]);

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
    when: v.variant("by", [
      v.object({ by: v.literal("sim"), sims: v.array(simMatcherSchema) }),
      v.object({ by: v.literal("device"), devices: v.array(str) }),
    ]),
    concepts: v.record(str, conceptValueSchema),
    apns: v.array(apnSchema),
  })),
}) satisfies v.GenericSchema<unknown, Profile>;

export const carrierIndexSchema = v.array(v.object({
  id: str,
  name: str,
  iso: opt(str),
  platforms: v.array(v.picklist(PLATFORMS)),
  updated: opt(str),
  members: v.array(str),
}) satisfies v.GenericSchema<unknown, CarrierSummary>);

const timelineCopySchema = v.variant("via", [
  v.object({ via: v.literal("image"), releases: v.array(str), sha: str, cid: opt(str) }),
  v.object({ via: v.literal("ota"), os: v.array(str), url: str, published: opt(str), digest: opt(digestSchema), archive: archiveSchema }),
]);

const line = v.array(v.object({
  slug: str,
  version: str,
  copies: v.tupleWithRest([timelineCopySchema], timelineCopySchema),
  beta: v.boolean(),
  changed: v.boolean(),
}));

/** The part of a CarrierDoc the scan reads. */
export const carrierTimelinesSchema = v.object({
  timelines: v.record(str, v.variant("family", [
    v.object({ family: v.literal("apple"), entries: line, models: v.record(str, line) }),
    v.object({ family: v.literal("android"), devices: v.record(str, line), canonical: v.record(str, str) }),
  ])),
}) satisfies v.GenericSchema<unknown, Pick<CarrierDoc, "timelines">>;

export const scanPointerSchema = v.object({
  format: v.literal(2),
  gen: str,
  builtAt: str,
  sources: v.number(),
  previous: v.nullable(str),
  heads: str,
  complete: v.boolean(),
}) satisfies v.GenericSchema<unknown, ScanPointer>;

/** The record at `key` validated by `schema`; null when absent; throws with the key when malformed. */
export async function readRecord<S extends v.GenericSchema>(r2: R2Client, key: string, schema: S): Promise<v.InferOutput<S> | null> {
  const raw = await r2.getJson(key);
  if (raw === null) return null;
  const parsed = v.safeParse(schema, raw);
  if (!parsed.success) throw new Error(`${key}: ${v.summarize(parsed.issues)}`);
  return parsed.output;
}
