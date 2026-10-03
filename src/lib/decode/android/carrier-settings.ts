/**
 * CarrierSettings / MultiCarrierSettings (AOSP carrier_settings.proto), the
 * <canonical>.pb files under product/etc/CarrierSettings/. Only what the file
 * sets is reported: proto2 defaults (authtype -1, user_visible true, ...) are
 * not filled in, so "unset" and "set to the default" stay distinguishable.
 * Unknown fields are collected, with where they sat, in `unknown`.
 */

import type {
  AndroidApnType, AndroidProtocol, ApnItem, CarrierConfigValue, CarrierSettings,
  MultiCarrierSettings, UnknownField, VendorConfigClient,
} from "./types.ts";
import { bytesToBase64 } from "../../binary/index.ts";
import { WireReader } from "./wire.ts";

/** ApnItem.ApnType by number. */
const APN_TYPES = [
  "ALL", "DEFAULT", "MMS", "SUPL", "DUN", "HIPRI", "FOTA", "IMS", "CBS", "IA", "EMERGENCY", "XCAP", "UT", "RCS",
] as const satisfies readonly AndroidApnType[];

const PROTOCOLS = ["IP", "IPV6", "IPV4V6", "PPP"] as const satisfies readonly AndroidProtocol[];

const XLAT = ["SKIP_464XLAT_DEFAULT", "SKIP_464XLAT_DISABLE", "SKIP_464XLAT_ENABLE"] as const;

/** An enum value by number, or `UNKNOWN_<n>` for numbers newer than this table. */
function enumName<T extends string>(names: readonly T[], n: number): T | `UNKNOWN_${number}` {
  return names[n] ?? `UNKNOWN_${n}`;
}

/** Where decoded unknowns go; one list per file, each entry says where it was found. */
type Sink = UnknownField[];

function decodeApn(bytes: Uint8Array, path: string, sink: Sink): ApnItem {
  const r = new WireReader(bytes);
  const apn: ApnItem = { type: [] };
  for (let t = r.tag(); t; t = r.tag()) {
    switch (t.key) {
      case "1:bytes": apn.name = r.string(); break;
      case "2:bytes": apn.value = r.string(); break;
      case "3:varint":
      case "3:bytes": apn.type.push(...r.int32s(t.wire).map((n) => enumName(APN_TYPES, n))); break;
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

/** CarrierApns: `repeated ApnItem apn = 2`. */
function decodeApns(bytes: Uint8Array, into: ApnItem[], sink: Sink): void {
  const r = new WireReader(bytes);
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "2:bytes") into.push(decodeApn(r.bytes(), `apns[${into.length}]`, sink));
    else sink.push(r.unknown(t, "apns"));
  }
}

/** TextArray / IntArray: `repeated item = 1`. */
function decodeTextArray(bytes: Uint8Array, path: string, sink: Sink): string[] {
  const r = new WireReader(bytes);
  const out: string[] = [];
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:bytes") out.push(r.string());
    else sink.push(r.unknown(t, path));
  }
  return out;
}

function decodeIntArray(bytes: Uint8Array, path: string, sink: Sink): number[] {
  const r = new WireReader(bytes);
  const out: number[] = [];
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:varint" || t.key === "1:bytes") out.push(...r.int32s(t.wire));
    else sink.push(r.unknown(t, path));
  }
  return out;
}

/**
 * CarrierConfig.Config: a key and one oneof value. Read in two steps because
 * the key, which names the path, may come after the value on the wire.
 */
function decodeConfig(bytes: Uint8Array, parent: string, sink: Sink): { key: string; value: CarrierConfigValue } | undefined {
  const r = new WireReader(bytes);
  const local: Sink = [];
  let key: string | undefined;
  let value: CarrierConfigValue | undefined;
  // Nested values are decoded after the key is known, so their unknowns get the right path.
  let pending: { field: 6 | 7 | 8; bytes: Uint8Array } | undefined;
  for (let t = r.tag(); t; t = r.tag()) {
    switch (t.key) {
      case "1:bytes": key = r.string(); break;
      case "2:bytes": value = { type: "text", value: r.string() }; break;
      case "3:varint": value = { type: "int", value: r.int32() }; break;
      case "4:varint": value = { type: "long", value: r.int64() }; break;
      case "5:varint": value = { type: "bool", value: r.bool() }; break;
      case "9:fixed64": value = { type: "double", value: r.double() }; break;
      case "6:bytes": pending = { field: 6, bytes: r.bytes() }; value = undefined; break;
      case "7:bytes": pending = { field: 7, bytes: r.bytes() }; value = undefined; break;
      case "8:bytes": pending = { field: 8, bytes: r.bytes() }; value = undefined; break;
      default: local.push(r.unknown(t, ""));
    }
    if (value) pending = undefined; // oneof: the last member on the wire wins
  }
  const path = `${parent}.${key ?? "?"}`;
  sink.push(...local.map((u) => ({ ...u, path })));
  if (pending?.field === 6) value = { type: "text_array", value: decodeTextArray(pending.bytes, path, sink) };
  else if (pending?.field === 7) value = { type: "int_array", value: decodeIntArray(pending.bytes, path, sink) };
  else if (pending?.field === 8) value = { type: "bundle", value: decodeConfigs(pending.bytes, path, sink) };
  if (key === undefined || value === undefined) {
    // Not representable in `configs`; keep the whole entry visible rather than drop it.
    sink.push({ path: parent, field: 2, wire: "bytes", value: bytesToBase64(bytes) });
    return undefined;
  }
  return { key, value };
}

/** CarrierConfig: `repeated Config config = 2`. A repeated key keeps its last value, as Android's loader does. */
function decodeConfigs(bytes: Uint8Array, path: string, sink: Sink): Record<string, CarrierConfigValue> {
  const r = new WireReader(bytes);
  const out: Record<string, CarrierConfigValue> = {};
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key !== "2:bytes") {
      sink.push(r.unknown(t, path));
      continue;
    }
    const entry = decodeConfig(r.bytes(), path, sink);
    if (entry) out[entry.key] = entry.value;
  }
  return out;
}

function decodeVendorClient(bytes: Uint8Array, path: string, sink: Sink): VendorConfigClient {
  const r = new WireReader(bytes);
  let name = "";
  let value: string | undefined;
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:bytes") name = r.string();
    else if (t.key === "2:bytes") value = bytesToBase64(r.bytes());
    // Fields 100-5000 are proto2 extensions vendors define; without their schema they are unknown.
    else sink.push(r.unknown(t, path));
  }
  return value === undefined ? { name } : { name, value };
}

/** VendorConfigs: `repeated VendorConfigClient client = 2`. */
function decodeVendorConfigs(bytes: Uint8Array, into: VendorConfigClient[], sink: Sink): void {
  const r = new WireReader(bytes);
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "2:bytes") into.push(decodeVendorClient(r.bytes(), `vendorConfigs[${into.length}]`, sink));
    else sink.push(r.unknown(t, "vendorConfigs"));
  }
}

function settingsFrom(bytes: Uint8Array, sink: Sink): CarrierSettings {
  const r = new WireReader(bytes);
  const cs: CarrierSettings = { canonicalName: "", apns: [], configs: {}, vendorConfigs: [] };
  for (let t = r.tag(); t; t = r.tag()) {
    switch (t.key) {
      case "1:bytes": cs.canonicalName = r.string(); break;
      case "2:varint": cs.version = r.int64(); break;
      case "3:bytes": decodeApns(r.bytes(), cs.apns, sink); break;
      // A repeated message field merges, so two configs records add up.
      case "4:bytes": Object.assign(cs.configs, decodeConfigs(r.bytes(), "configs", sink)); break;
      case "6:bytes": decodeVendorConfigs(r.bytes(), cs.vendorConfigs, sink); break;
      default: sink.push(r.unknown(t, ""));
    }
  }
  return cs;
}

/** Collects unknowns in a fresh list and attaches it only when non-empty. */
function withUnknown<T extends object>(value: T, sink: Sink): T & { unknown?: UnknownField[] } {
  return sink.length ? { ...value, unknown: sink } : value;
}

/** One <canonical_name>.pb (also default.pb and no_sim.pb). */
export function decodeCarrierSettings(bytes: Uint8Array): CarrierSettings {
  const sink: Sink = [];
  return withUnknown(settingsFrom(bytes, sink), sink);
}

/** others.pb: many CarrierSettings in one file. Each setting keeps its own unknowns. */
export function decodeMultiCarrierSettings(bytes: Uint8Array): MultiCarrierSettings {
  const r = new WireReader(bytes);
  const sink: Sink = [];
  const out: MultiCarrierSettings = { settings: [] };
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:varint") out.version = r.int64();
    else if (t.key === "2:bytes") out.settings.push(decodeCarrierSettings(r.bytes()));
    else sink.push(r.unknown(t, ""));
  }
  return withUnknown(out, sink);
}

/** others.pb split into its parts, byte for byte: each part is a complete CarrierSettings message. */
export interface SplitMultiCarrierSettings {
  readonly version?: string;
  readonly settings: readonly Uint8Array[];
}

export function splitMultiCarrierSettings(bytes: Uint8Array): SplitMultiCarrierSettings {
  const r = new WireReader(bytes);
  let version: string | undefined;
  const settings: Uint8Array[] = [];
  for (let t = r.tag(); t; t = r.tag()) {
    if (t.key === "1:varint") version = r.int64();
    else if (t.key === "2:bytes") settings.push(r.bytes());
    // Unknown top-level fields have no CarrierSettings to belong to; decodeMultiCarrierSettings reports them.
    else r.unknown(t, "");
  }
  return version === undefined ? { settings } : { version, settings };
}

/**
 * A CarrierSettings message with `version` (field 2) appended. Protobuf
 * merges a field that appears again, so this sets the version without
 * re-encoding: used to give an others.pb part, which carries no version of
 * its own, the version of the file it came from.
 */
export function withCarrierSettingsVersion(setting: Uint8Array, version: string): Uint8Array {
  const tail = [0x10, ...varint(BigInt.asUintN(64, BigInt(version)))];
  const out = new Uint8Array(setting.length + tail.length);
  out.set(setting);
  out.set(tail, setting.length);
  return out;
}

function varint(v: bigint): number[] {
  const out: number[] = [];
  let rest = v;
  do {
    const low = Number(rest & 0x7fn);
    rest >>= 7n;
    out.push(rest ? low | 0x80 : low);
  } while (rest);
  return out;
}
