/** Valibot schemas for modem package summaries (decoded/baseband/v<N>/), typed against the decoder's own types. */

import * as v from "valibot";
import {
  CONTENT_FORMATS, MODEM_SUMMARY_SCHEMA,
  type BandComboSet, type BasebandContainer, type BasebandFile, type BasebandImage, type BasebandMdb, type BasebandModemEfs,
  type BasebandNvBlob, type BasebandNvRecord, type BasebandSsgccs, type BbcfgMeta, type CarrierMapping, type ModemConfigSummary,
  type ModemSummary, type Variant,
} from "@carrier-explode/decode-ios";
import { CONFIDENCES, CONFIDENCES_OR_UNKNOWN } from "@carrier-explode/decode-qualcomm";
import type {
  AmprGroup, ArfcnRange, ComboStats, McfgTrailerSummary, MccScanEntry, MdbHeader, PlmnFeatures, SsgccsConfig, SsgccsLine, XmlRefs,
} from "@carrier-explode/decode-qualcomm";

type Schema<T> = v.GenericSchema<unknown, T>;

const str = v.string();
const num = v.number();
const strs = v.array(str);
const nums = v.array(num);
const opt = <S extends v.GenericSchema>(s: S): v.ExactOptionalSchema<S, undefined> => v.exactOptional(s);
const confidence = v.picklist(CONFIDENCES);
const confidenceOrUnknown = v.picklist(CONFIDENCES_OR_UNKNOWN);

const variant: Schema<Variant> = v.object({ platform: num, sku: num, hwRev: num });
const variants = v.array(variant);

const xmlRefs: Schema<XmlRefs> = v.object({ policy: opt(str), carriers: opt(strs), plmns: opt(strs), mccs: opt(strs) });

const file: Schema<BasebandFile> = v.object({
  member: str, path: str, format: v.picklist(CONTENT_FORMATS), length: num, sha1: str,
  text: opt(str), hex: opt(str), blobs: opt(nums), variants: opt(variants), configs: opt(strs), refs: opt(xmlRefs),
});

const nvRecord: Schema<BasebandNvRecord> = v.object({
  nv: opt(num), efs: opt(str), hex: str, f11: opt(num), f14: opt(num), f77: opt(num), f78: opt(num),
  name: opt(str), meaning: opt(str), label: opt(str), confidence: opt(confidence),
});

const nvBlob: Schema<BasebandNvBlob> = v.object({
  member: str, blob: num, fileType: num, fileTypeName: str, digest: str, variants, records: v.array(nvRecord),
});

const trailer: Schema<McfgTrailerSummary> = v.object({
  trailerVersion: opt(str), version: opt(str), label: opt(str), baseVersion: opt(str), capability: opt(str), digest: opt(str),
});

const image: Schema<BasebandImage> = v.object({
  member: str, blob: num, fileType: num, fileTypeName: str, variants, cfgType: str, version: str, trailer: opt(trailer), files: strs,
});

const meta: Schema<BbcfgMeta> = v.object({
  project: opt(str), versionHex: opt(str), version: opt(str), buildHost: opt(str), buildUser: opt(str),
  field84: opt(str), field85: opt(str), buildTime: opt(str), sourceRevision: opt(str),
});

const container: Schema<BasebandContainer> = v.object({
  member: str, magic: str, headerVersion: num, meta, records: num, blobs: num,
  fileTypes: v.array(v.object({ type: num, name: str, confidence: opt(confidence), note: opt(str), blobs: num, records: num })),
  errors: opt(v.array(v.object({ blob: num, error: str }))),
});

const comboStats: Schema<ComboStats> = v.object({
  combos: num, endc: num, nr: num, lte: num, nrdc: num, swul: num, maxComponents: num,
  nrBands: nums, singleBands: nums, fr1Bands: nums, fr2Bands: nums, lteAnchors: nums, sulBands: nums,
});

const bandCombos: Schema<BandComboSet> = v.object({
  sha1: str, variants, carriers: v.array(v.intersect([v.object({ tag: str, plmns: strs }), comboStats])),
});

const carrierMapping: Schema<CarrierMapping> = v.object({ plmns: strs, bundles: strs, mvnoBundles: strs });

const ampr: Schema<AmprGroup> = v.object({
  mccs: strs, bands: v.array(v.object({ band: num, nsNoCa: opt(num), nsWithCa: opt(num) })),
});

const modemConfig: Schema<ModemConfigSummary> = v.object({
  offset: num, container: v.picklist(["zlib", "plain"]), length: num, label: opt(str), cfgType: str, format: num, version: str,
  trailer: opt(trailer), files: strs,
});

const mdbHeader: Schema<MdbHeader> = v.object({ version: num, layout: num, creator: str, built: opt(str) });
const arfcnRange: Schema<ArfcnRange> = v.object({ lo: num, hi: num, loMHz: num, hiMHz: num, uplink: v.boolean(), x: num });
const mccScan: Schema<MccScanEntry> = v.object({ mcc: opt(str), key: num, flags: num, ranges: v.array(arfcnRange), band: opt(num) });
const plmnFeatures: Schema<PlmnFeatures> = v.object({ plmns: strs, tag: num, features: opt(v.array(v.tuple([num, num]))), hex: opt(str) });

const mdb: Schema<BasebandMdb> = v.object({
  member: str, path: str, sha1: str, variants: opt(variants), configs: opt(strs), header: opt(mdbHeader),
  scan: opt(v.array(mccScan)), features: opt(v.array(plmnFeatures)), error: opt(str),
});

const modemEfs: Schema<BasebandModemEfs> = v.object({
  member: str, path: str, sha1: str, variants: opt(variants), configs: opt(strs), hex: str, name: str, value: str, confidence,
});

const ssgccsLine: Schema<SsgccsLine> = v.object({
  key: str, title: str, confidence: confidenceOrUnknown, raw: str,
  fields: v.array(v.object({ name: str, value: str, meaning: opt(str), confidence: confidenceOrUnknown })),
});
const ssgccsConfig: Schema<SsgccsConfig> = v.object({
  allNetworks: v.boolean(), plmns: strs, custom: opt(ssgccsLine), rats: v.array(ssgccsLine), other: v.array(ssgccsLine),
});
const ssgccs: Schema<BasebandSsgccs> = v.object({
  variants: opt(variants), configs: opt(strs), files: v.array(v.object({ path: str, sha1: str, text: str })), config: ssgccsConfig,
});

const bbfw = v.object({
  schema: v.literal(MODEM_SUMMARY_SCHEMA),
  kind: v.literal("bbfw"),
  package: v.object({
    name: opt(str), family: opt(str), version: opt(str), chipId: opt(str), sblVersion: opt(str), restoreSblVersion: opt(str),
  }),
  members: v.array(v.object({ name: str, size: num })),
  containers: v.array(container),
  files: v.array(file),
  nv: v.array(nvBlob),
  images: v.array(image),
  bandCombos: v.array(bandCombos),
  carrierMap: opt(v.record(str, carrierMapping)),
  amprNs: v.array(v.object({ sha1: str, variants, groups: v.array(ampr) })),
  modemConfigs: opt(v.array(modemConfig)),
  mdb: opt(v.object({ databases: v.array(mdb), settings: v.array(modemEfs), plmnBundles: opt(v.record(str, strs)) })),
  ssgccs: opt(v.array(ssgccs)),
});

const ftab = v.object({
  schema: v.literal(MODEM_SUMMARY_SCHEMA),
  kind: v.literal("ftab"),
  package: v.object({
    build: opt(str), version: opt(str), date: opt(str), chip: opt(str), chipRevision: opt(str), name: opt(str), family: opt(str), bver: opt(str),
  }),
  entries: v.array(v.object({ tag: str, offset: num, size: num })),
});

export const modemSummary: Schema<ModemSummary> = v.variant("kind", [bbfw, ftab]);
