/**
 * CarrierSettings and MultiCarrierSettings (carrier_settings.proto). Only what
 * a file sets is reported, so "unset" and "set to the proto default" differ.
 */

import { bytesToBase64 } from "../../binary/index.ts";
import type {
  AndroidApnType, AndroidProtocol, ApnItem, CarrierConfigValue, CarrierSettings,
  MultiCarrierSettings, Skip464Xlat, UnknownEnum, UnknownField, VendorConfigClient,
} from "./types.ts";
import { ProtobufError, WireReader, type Tag } from "./wire.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const APN_TYPES = [
  "ALL", "DEFAULT", "MMS", "SUPL", "DUN", "HIPRI", "FOTA", "IMS", "CBS", "IA", "EMERGENCY", "XCAP", "UT", "RCS",
] as const satisfies readonly AndroidApnType[];
const PROTOCOLS = ["IP", "IPV6", "IPV4V6", "PPP"] as const satisfies readonly AndroidProtocol[];
const XLAT = ["SKIP_464XLAT_DEFAULT", "SKIP_464XLAT_DISABLE", "SKIP_464XLAT_ENABLE"] as const satisfies readonly Skip464Xlat[];

function enumName<T extends string>(names: readonly T[], n: number): T | UnknownEnum {
  return names[n] ?? `UNKNOWN_${n}`;
}

/** Unknown fields of one file, each with where it was found. */
type Sink = UnknownField[];

function decodeApn(bytes: Uint8Array, path: string, sink: Sink): ApnItem {
  const r = new WireReader(bytes);
  const type: AndroidApnType[] = [];
  const apn: Mutable<ApnItem> = { type };
  for (let t = r.tag(); t; t = r.tag()) {
    switch (t.key) {
      case "1:bytes": apn.name = r.string(); break;
      case "2:bytes": apn.value = r.string(); break;
      case "3:varint":
      case "3:bytes": type.push(...r.int32s(t.wire).map((n) => enumName(APN_TYPES, n))); break;
      case "4:bytes": apn.bearerBitmask = r.string(); break;
      case "5:bytes": apn.server = r.string(); break;
      case "6:bytes": apn.proxy = r.string(); break;
      case "7:bytes": apn.port = r.string(); break;
      case "8:bytes": apn.user = r.string(); break;
      case "9:bytes": apn.password = r.string(); break;
      case "10:varint": apn.authtype = r.int32(); break;
      case "11:bytes": apn.mmsc = r.string(); break;
      case "12:bytes": apn.mmscProxy = r.string(); break;
      case "13:bytes": apn.mmscProxyPort = r.string(); break;
      case "14:varint": apn.protocol = enumName(PROTOCOLS, r.int32()); break;
      case "15:varint": apn.roamingProtocol = enumName(PROTOCOLS, r.int32()); break;
      case "16:varint": apn.mtu = r.int32(); break;
      case "17:varint": apn.profileId = r.int32(); break;
      case "18:varint": apn.maxConns = r.int32(); break;
      case "19:varint": apn.waitTime = r.int32(); break;
      case "20:varint": apn.maxConnsTime = r.int32(); break;
      case "22:varint": apn.modemCognitive = r.bool(); break;
      case "23:varint": apn.userVisible = r.bool(); break;
      case "24:varint": apn.userEditable = r.bool(); break;
      case "25:varint": apn.apnSetId = r.int32(); break;
      case "26:varint": apn.skip464xlat = enumName(XLAT, r.int32()); break;
      default: sink.push(r.unknown(t, path));
    }
  }
  return apn;
}

/** Reads one occurrence of a repeated field, or returns undefined when the tag is not that field. */
type ItemReader<T> = (r: WireReader, t: Tag) => readonly T[] | undefined;

/** The items of a wrapper message holding one repeated field. */
function repeated<T>(bytes: Uint8Array, read: ItemReader<T>, path: string, sink: Sink): T[] {
  const r = new WireReader(bytes);
  const out: T[] = [];
  for (let t = r.tag(); t; t = r.tag()) {
    const items = read(r, t);
    if (items) out.push(...items);
    else sink.push(r.unknown(t, path));
  }
  return out;
}

const textItems: ItemReader<string> = (r, t) => (t.key === "1:bytes" ? [r.string()] : undefined);
const intItems: ItemReader<number> = (r, t) => (t.key === "1:bytes" || t.key === "1:varint" ? r.int32s(t.wire) : undefined);

/** A Config value held raw until its key is known, since the key names the path and may come last. */
type PendingValue = { readonly kind: "scalar"; readonly value: CarrierConfigValue } | { readonly kind: 6 | 7 | 8; readonly bytes: Uint8Array };

function resolveValue(pending: PendingValue, path: string, sink: Sink): CarrierConfigValue {
  switch (pending.kind) {
    case "scalar": return pending.value;
    case 6: return { type: "text_array", value: repeated(pending.bytes, textItems, path, sink) };
    case 7: return { type: "int_array", value: repeated(pending.bytes, intItems, path, sink) };
    case 8: return { type: "bundle", value: decodeConfigs(pending.bytes, path, sink) };
  }
}

/** CarrierConfig.Config. One without a key or value cannot sit in `configs`, so it is kept whole as unknown. */
function decodeConfig(bytes: Uint8Array, parent: string, sink: Sink): Array<readonly [string, CarrierConfigValue]> {
  const r = new WireReader(bytes);
  const local: Sink = [];
  let key: string | undefined;
  let pending: PendingValue | undefined;
  for (let t = r.tag(); t; t = r.tag()) {
    switch (t.key) {
      case "1:bytes": key = r.string(); break;
      case "2:bytes": pending = { kind: "scalar", value: { type: "text", value: r.string() } }; break;
      case "3:varint": pending = { kind: "scalar", value: { type: "int", value: r.int32() } }; break;
      case "4:varint": pending = { kind: "scalar", value: { type: "long", value: r.int64() } }; break;
      case "5:varint": pending = { kind: "scalar", value: { type: "bool", value: r.bool() } }; break;
      case "9:fixed64": pending = { kind: "scalar", value: { type: "double", value: r.double() } }; break;
      case "6:bytes": pending = { kind: 6, bytes: r.bytes() }; break;
      case "7:bytes": pending = { kind: 7, bytes: r.bytes() }; break;
      case "8:bytes": pending = { kind: 8, bytes: r.bytes() }; break;
      default: local.push(r.unknown(t, ""));
    }
  }
  if (key === undefined || pending === undefined) {
    sink.push({ path: parent, field: 2, wire: "bytes", value: bytesToBase64(bytes) });
    return [];
  }
  const path = `${parent}.${key}`;
  sink.push(...local.map((u) => ({ ...u, path })));
  return [[key, resolveValue(pending, path, sink)]];
}

/** CarrierConfig. A repeated key keeps its last value, as Android's loader does. */
function decodeConfigs(bytes: Uint8Array, path: string, sink: Sink): Record<string, CarrierConfigValue> {
  const configItems: ItemReader<readonly [string, CarrierConfigValue]> = (r, t) => (t.key === "2:bytes" ? decodeConfig(r.bytes(), path, sink) : undefined);
  return Object.fromEntries(repeated(bytes, configItems, path, sink));
}

function decodeVendorClient(bytes: Uint8Array, path: string, sink: Sink): VendorConfigClient {
  const r = new WireReader(bytes);
  let name: string | undefined;
  let value: string | undefined;
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:bytes") name = r.string();
    else if (t.key === "2:bytes") value = bytesToBase64(r.bytes());
    // Fields 100-5000 are vendor extensions, unknown without their schema.
    else sink.push(r.unknown(t, path));
  }
  if (name === undefined) throw new ProtobufError(`${path}: VendorConfigClient without its required name`);
  return value === undefined ? { name } : { name, value };
}

/** One <canonical>.pb (also default.pb, no_sim.pb, and each part of others.pb). */
export function decodeCarrierSettings(bytes: Uint8Array): CarrierSettings {
  const r = new WireReader(bytes);
  const sink: Sink = [];
  const apns: ApnItem[] = [];
  const configs: Record<string, CarrierConfigValue> = {};
  const vendorConfigs: VendorConfigClient[] = [];
  const apnItems: ItemReader<ApnItem> = (rr, t) => (t.key === "2:bytes" ? [decodeApn(rr.bytes(), `apns[${apns.length}]`, sink)] : undefined);
  const vendorItems: ItemReader<VendorConfigClient> = (rr, t) =>
    t.key === "2:bytes" ? [decodeVendorClient(rr.bytes(), `vendorConfigs[${vendorConfigs.length}]`, sink)] : undefined;
  const cs: Mutable<CarrierSettings> = { apns, configs, vendorConfigs, unknown: sink };
  for (let t = r.tag(); t; t = r.tag()) {
    switch (t.key) {
      case "1:bytes": cs.canonicalName = r.string(); break;
      case "2:varint": cs.version = r.int64(); break;
      case "3:bytes": apns.push(...repeated(r.bytes(), apnItems, "apns", sink)); break;
      // An embedded message seen twice merges.
      case "4:bytes": Object.assign(configs, decodeConfigs(r.bytes(), "configs", sink)); break;
      case "6:bytes": vendorConfigs.push(...repeated(r.bytes(), vendorItems, "vendorConfigs", sink)); break;
      default: sink.push(r.unknown(t, ""));
    }
  }
  return cs;
}

/** others.pb cut into its parts, byte for byte; each part is a complete CarrierSettings message. */
export interface SplitMultiCarrierSettings {
  readonly version?: string;
  readonly settings: readonly Uint8Array[];
  readonly unknown: readonly UnknownField[];
}

export function splitMultiCarrierSettings(bytes: Uint8Array): SplitMultiCarrierSettings {
  const r = new WireReader(bytes);
  const unknown: Sink = [];
  const settings: Uint8Array[] = [];
  let version: string | undefined;
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:varint") version = r.int64();
    else if (t.key === "2:bytes") settings.push(r.bytes());
    else unknown.push(r.unknown(t, ""));
  }
  return version === undefined ? { settings, unknown } : { version, settings, unknown };
}

/** others.pb, decoded. Each setting keeps its own unknowns. */
export function decodeMultiCarrierSettings(bytes: Uint8Array): MultiCarrierSettings {
  const { version, settings, unknown } = splitMultiCarrierSettings(bytes);
  const decoded = settings.map(decodeCarrierSettings);
  return version === undefined ? { settings: decoded, unknown } : { version, settings: decoded, unknown };
}
