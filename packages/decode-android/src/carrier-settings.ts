/** CarrierSettings and MultiCarrierSettings (carrier_settings.proto). Only what a file sets is reported, so unset and default differ. */

import { bytesToBase64, wireFields, type WireField } from "@carrier-explode/binary";
import { MissingFieldError } from "./errors.ts";
import {
  APN_TYPES, PROTOCOLS, XLAT,
  type AndroidApnType, type ApnItem, type CarrierConfigValue, type CarrierSettings, type UnknownEnum, type UnknownField, type VendorConfigClient,
} from "./types.ts";
import { double, int32, int32s, int64, text, unknownField } from "./wire.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function enumName<T extends string>(names: readonly T[], n: number): T | UnknownEnum {
  return names[n] ?? `UNKNOWN_${n}`;
}

/** Unknown fields of one file, each with where it was found. */
type Sink = UnknownField[];

type Entry = readonly [string, CarrierConfigValue];

/** Reads one item field of a repeated wrapper message, or gives undefined for any other field. */
type ItemReader<T> = (f: WireField, index: number) => readonly T[] | undefined;

/** The items of a wrapper message holding one repeated field. */
function repeated<T>(bytes: Uint8Array, read: ItemReader<T>, path: string, sink: Sink): T[] {
  const out: T[] = [];
  for (const f of wireFields(bytes)) {
    const items = read(f, out.length);
    if (items === undefined) sink.push(unknownField(f, path));
    else out.push(...items);
  }
  return out;
}

const textItems: ItemReader<string> = (f) => (f.key === "1:bytes" ? [text(f.value)] : undefined);
const intItems: ItemReader<number> = (f) => (f.key === "1:bytes" || f.key === "1:varint" ? int32s(f) : undefined);

function decodeApn(bytes: Uint8Array, path: string, sink: Sink): ApnItem {
  const type: AndroidApnType[] = [];
  const apn: Mutable<ApnItem> = { type };
  for (const f of wireFields(bytes)) {
    switch (f.key) {
      case "1:bytes": apn.name = text(f.value); break;
      case "2:bytes": apn.value = text(f.value); break;
      case "3:varint":
      case "3:bytes": type.push(...int32s(f).map((n) => enumName(APN_TYPES, n))); break;
      case "4:bytes": apn.bearerBitmask = text(f.value); break;
      case "5:bytes": apn.server = text(f.value); break;
      case "6:bytes": apn.proxy = text(f.value); break;
      case "7:bytes": apn.port = text(f.value); break;
      case "8:bytes": apn.user = text(f.value); break;
      case "9:bytes": apn.password = text(f.value); break;
      case "10:varint": apn.authtype = int32(f.value); break;
      case "11:bytes": apn.mmsc = text(f.value); break;
      case "12:bytes": apn.mmscProxy = text(f.value); break;
      case "13:bytes": apn.mmscProxyPort = text(f.value); break;
      case "14:varint": apn.protocol = enumName(PROTOCOLS, int32(f.value)); break;
      case "15:varint": apn.roamingProtocol = enumName(PROTOCOLS, int32(f.value)); break;
      case "16:varint": apn.mtu = int32(f.value); break;
      case "17:varint": apn.profileId = int32(f.value); break;
      case "18:varint": apn.maxConns = int32(f.value); break;
      case "19:varint": apn.waitTime = int32(f.value); break;
      case "20:varint": apn.maxConnsTime = int32(f.value); break;
      case "22:varint": apn.modemCognitive = f.value !== 0n; break;
      case "23:varint": apn.userVisible = f.value !== 0n; break;
      case "24:varint": apn.userEditable = f.value !== 0n; break;
      case "25:varint": apn.apnSetId = int32(f.value); break;
      case "26:varint": apn.skip464xlat = enumName(XLAT, int32(f.value)); break;
      default: sink.push(unknownField(f, path));
    }
  }
  return apn;
}

/** A Config's value, resolved once its key is known: the key names the path of anything nested, and may come last. */
type PendingValue = (path: string) => CarrierConfigValue;

function pendingValue(f: WireField, sink: Sink): PendingValue | undefined {
  const scalar = (v: CarrierConfigValue): PendingValue => () => v;
  switch (f.key) {
    case "2:bytes": return scalar({ kind: "text", value: text(f.value) });
    case "3:varint": return scalar({ kind: "int", value: int32(f.value) });
    case "4:varint": return scalar({ kind: "long", value: int64(f.value) });
    case "5:varint": return scalar({ kind: "bool", value: f.value !== 0n });
    case "9:fixed64": return scalar({ kind: "double", value: double(f.value) });
    case "6:bytes": return (path) => ({ kind: "text_array", value: repeated(f.value, textItems, path, sink) });
    case "7:bytes": return (path) => ({ kind: "int_array", value: repeated(f.value, intItems, path, sink) });
    case "8:bytes": return (path) => ({ kind: "bundle", value: Object.fromEntries(configEntries(f.value, path, sink)) });
    default: return undefined;
  }
}

/** CarrierConfig.Config. One without a key or a value cannot sit in `configs`, so it is kept whole as unknown. */
function decodeConfig(bytes: Uint8Array, parent: string, sink: Sink): Entry[] {
  const unnamed: WireField[] = [];
  let key: string | undefined;
  let pending: PendingValue | undefined;
  for (const f of wireFields(bytes)) {
    if (f.key === "1:bytes") {
      key = text(f.value);
      continue;
    }
    const value = pendingValue(f, sink);
    if (value === undefined) unnamed.push(f);
    else pending = value;
  }
  if (key === undefined || pending === undefined) {
    sink.push({ path: parent, field: 2, wire: "bytes", value: bytesToBase64(bytes) });
    return [];
  }
  const path = `${parent}.${key}`;
  sink.push(...unnamed.map((f) => unknownField(f, path)));
  return [[key, pending(path)]];
}

/** CarrierConfig's entries. A key repeated keeps its last value, as Android's loader does. */
function configEntries(bytes: Uint8Array, path: string, sink: Sink): Entry[] {
  return repeated(bytes, (f) => (f.key === "2:bytes" ? decodeConfig(f.value, path, sink) : undefined), path, sink);
}

function decodeVendorClient(bytes: Uint8Array, path: string, sink: Sink): VendorConfigClient {
  let name: string | undefined;
  let value: string | undefined;
  for (const f of wireFields(bytes)) {
    if (f.key === "1:bytes") name = text(f.value);
    else if (f.key === "2:bytes") value = bytesToBase64(f.value);
    // Fields 100-5000 are vendor extensions, unknown without their schema.
    else sink.push(unknownField(f, path));
  }
  if (name === undefined) throw new MissingFieldError(path, "name");
  return value === undefined ? { name } : { name, value };
}

/** ApnList / VendorConfigs items, numbered on from `first`: a list seen twice merges. */
const apnItems = (first: number, sink: Sink): ItemReader<ApnItem> => (f, i) =>
  f.key === "2:bytes" ? [decodeApn(f.value, `apns[${first + i}]`, sink)] : undefined;
const vendorItems = (first: number, sink: Sink): ItemReader<VendorConfigClient> => (f, i) =>
  f.key === "2:bytes" ? [decodeVendorClient(f.value, `vendorConfigs[${first + i}]`, sink)] : undefined;

/** One <canonical>.pb (also default.pb, no_sim.pb, and each part of others.pb). */
export function decodeCarrierSettings(bytes: Uint8Array): CarrierSettings {
  const sink: Sink = [];
  const apns: ApnItem[] = [];
  const configs: Entry[] = [];
  const vendorConfigs: VendorConfigClient[] = [];
  let canonicalName: string | undefined;
  let version: string | undefined;
  for (const f of wireFields(bytes)) {
    switch (f.key) {
      case "1:bytes": canonicalName = text(f.value); break;
      case "2:varint": version = int64(f.value); break;
      case "3:bytes": apns.push(...repeated(f.value, apnItems(apns.length, sink), "apns", sink)); break;
      // An embedded message seen twice merges.
      case "4:bytes": configs.push(...configEntries(f.value, "configs", sink)); break;
      case "6:bytes": vendorConfigs.push(...repeated(f.value, vendorItems(vendorConfigs.length, sink), "vendorConfigs", sink)); break;
      default: sink.push(unknownField(f, ""));
    }
  }
  if (!canonicalName) throw new MissingFieldError("", "canonical_name");
  const cs = { canonicalName, apns, configs: Object.fromEntries(configs), vendorConfigs, unknown: sink };
  return version === undefined ? cs : { ...cs, version };
}

/** others.pb cut into its parts, byte for byte; each part is a complete CarrierSettings message. */
export interface SplitMultiCarrierSettings {
  readonly version?: string;
  readonly settings: readonly Uint8Array[];
  readonly unknown: readonly UnknownField[];
}

export function splitMultiCarrierSettings(bytes: Uint8Array): SplitMultiCarrierSettings {
  const unknown: Sink = [];
  const settings: Uint8Array[] = [];
  let version: string | undefined;
  for (const f of wireFields(bytes)) {
    if (f.key === "1:varint") version = int64(f.value);
    else if (f.key === "2:bytes") settings.push(f.value);
    else unknown.push(unknownField(f, ""));
  }
  return version === undefined ? { settings, unknown } : { version, settings, unknown };
}
