/**
 * decode-android: CarrierSettings, MultiCarrierSettings, CarrierList and
 * config docs. Fixtures are altered copies of Pixel files plus messages built
 * here; CORPUS=<dir> also decodes <dir>/android/CarrierSettings/*.pb.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProtobufError } from "@carrier-explode/binary";
import { configDoc, decodeCarrierList, decodeCarrierSettings, MissingFieldError, splitMultiCarrierSettings } from "../src/index.ts";

/** The Pixel tree firmware's images are built from (packages/firmware/test/fixtures/android). */
const FIXTURES = join(import.meta.dirname, "../../firmware/test/fixtures/android/tree/etc/CarrierSettings");
const fixture = (name: string): Uint8Array => readFileSync(join(FIXTURES, name));

function varint(v: bigint): number[] {
  const out: number[] = [];
  let rest = BigInt.asUintN(64, v);
  do {
    const low = Number(rest & 0x7fn);
    rest >>= 7n;
    out.push(rest ? low | 0x80 : low);
  } while (rest);
  return out;
}
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};
const tag = (field: number, wire: number): number[] => varint(BigInt((field << 3) | wire));
const int = (field: number, v: number | bigint): Uint8Array => new Uint8Array([...tag(field, 0), ...varint(BigInt(v))]);
const bytes = (field: number, b: Uint8Array): Uint8Array => cat(new Uint8Array([...tag(field, 2), ...varint(BigInt(b.length))]), b);
const str = (field: number, s: string): Uint8Array => bytes(field, new TextEncoder().encode(s));
const msg = (field: number, ...parts: Uint8Array[]): Uint8Array => bytes(field, cat(...parts));
function dbl(field: number, x: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x, true);
  return cat(new Uint8Array(tag(field, 1)), b);
}
const config = (key: string, ...value: Uint8Array[]): Uint8Array => msg(2, str(1, key), ...value);

describe("decodeCarrierSettings", () => {
  it("decodes an altered Pixel file with every value type", () => {
    const cs = decodeCarrierSettings(fixture("spektrummso_us.pb"));
    expect(cs.canonicalName).toBe("spektrummso_us");
    expect(cs.version).toBe("79000000004");
    expect(cs.apns).toEqual([{ type: ["DEFAULT"], name: "Spektrum", value: "spektrum", protocol: "IPV4V6" }]);
    expect(cs.configs["lte_rsrp_thresholds_int_array"]).toEqual({ kind: "int_array", value: [-115, -105, -95, -85] });
    expect(cs.configs["imsss.xcap_over_ut_supported_rats_int_array"]).toEqual({ kind: "int_array", value: [] });
    expect(cs.configs["opportunistic.5g_backoff_time_long"]).toEqual({ kind: "long", value: "5000" });
    expect(cs.configs["opportunistic.entry_threshold_ss_rsrq_double"]).toEqual({ kind: "double", value: -35 });
    expect(cs.configs["boosted_lte_earfcns_string_array"]).toEqual({ kind: "text_array", value: ["600-1199", "1950-2399"] });
    expect(cs.configs["imsvoice.audio_codec_capability_payload_types_bundle"]).toMatchObject({
      kind: "bundle",
      value: { "imsvoice.amrnb_payload_type_int_array": { kind: "int_array", value: [98, 103] } },
    });
    // Field 8 is not in AOSP's proto; it is kept, not dropped.
    expect(cs.unknown).toEqual([{ path: "", field: 8, wire: "bytes", value: "CMPG9sgG" }]);
  });

  it("reports what is set and nothing else", () => {
    const cs = decodeCarrierSettings(fixture("skylo_zz.pb"));
    expect(cs.apns).toEqual([{
      type: ["DEFAULT"], name: "Skylo", value: "fixtr.ntn",
      protocol: "UNKNOWN_4", roamingProtocol: "UNKNOWN_4", userVisible: false, userEditable: false,
    }]);
    expect(cs.vendorConfigs).toEqual([]);
  });

  it("handles key-after-value, packed and unpacked arrays, negatives, repeats and unknowns", () => {
    const bundle = msg(8, config("inner_int", int(3, 7)), int(99, 1));
    const cs = decodeCarrierSettings(cat(
      str(1, "x_us"),
      int(2, 5n),
      msg(3, msg(2, int(3, 1), int(3, 2), int(14, 15), int(40, 3))),
      msg(4,
        msg(2, int(3, -2), str(1, "neg_int")),
        config("long", int(4, -9_000_000_000n)),
        config("dbl", dbl(9, 1.5)),
        config("unpacked_int_array", msg(7, int(1, 4), int(1, -1))),
        config("dup_bool", int(5, 1)),
        config("dup_bool", int(5, 0)),
        config("b_bundle", bundle),
        config("no_value"),
      ),
      msg(6, msg(2, str(1, "vendor"), bytes(2, new Uint8Array([1, 2])), int(100, 9))),
    ));
    expect(cs.apns).toEqual([{ type: ["DEFAULT", "MMS"], protocol: "UNKNOWN_15" }]);
    expect(cs.configs).toEqual({
      neg_int: { kind: "int", value: -2 },
      long: { kind: "long", value: "-9000000000" },
      dbl: { kind: "double", value: 1.5 },
      unpacked_int_array: { kind: "int_array", value: [4, -1] },
      dup_bool: { kind: "bool", value: false },
      b_bundle: { kind: "bundle", value: { inner_int: { kind: "int", value: 7 } } },
    });
    expect(cs.vendorConfigs).toEqual([{ name: "vendor", value: "AQI=" }]);
    expect(cs.unknown).toEqual([
      { path: "apns[0]", field: 40, wire: "varint", value: "3" },
      { path: "configs.b_bundle", field: 99, wire: "varint", value: "1" },
      { path: "configs", field: 2, wire: "bytes", value: "Cghub192YWx1ZQ==" },
      { path: "vendorConfigs[0]", field: 100, wire: "varint", value: "9" },
    ]);
  });

  it("numbers APNs and vendor configs across their lists", () => {
    const apn = (field: number): Uint8Array => msg(2, int(field, 1));
    const cs = decodeCarrierSettings(cat(str(1, "x"), msg(3, apn(40), apn(41)), msg(3, apn(42))));
    expect(cs.unknown.map((u) => [u.path, u.field])).toEqual([["apns[0]", 40], ["apns[1]", 41], ["apns[2]", 42]]);
  });

  it("keeps a __proto__ key as data", () => {
    const cs = decodeCarrierSettings(cat(str(1, "x"), msg(4, config("__proto__", int(5, 1)))));
    expect(Object.getPrototypeOf(cs.configs)).toBe(Object.prototype);
    expect(Object.hasOwn(cs.configs, "__proto__")).toBe(true);
  });

  it("rejects missing required fields, and malformed or truncated input", () => {
    expect(() => decodeCarrierSettings(cat(str(1, "x"), msg(6, msg(2, bytes(2, new Uint8Array([1]))))))).toThrow(
      expect.objectContaining({ name: "MissingFieldError", path: "vendorConfigs[0]", field: "name" }),
    );
    expect(() => decodeCarrierSettings(int(2, 1))).toThrow(MissingFieldError);
    expect(() => decodeCarrierList(msg(1, str(1, "x"), msg(2, str(2, "spn"))))).toThrow(/entries\[0\]\.carrierIds\[0\] has no mcc_mnc/);
    expect(() => decodeCarrierSettings(new Uint8Array([...tag(1, 3)]))).toThrow(ProtobufError);
    expect(() => decodeCarrierSettings(fixture("skylo_zz.pb").subarray(0, 50))).toThrow(RangeError);
  });
});

describe("others.pb", () => {
  const part = (name: string): Uint8Array => cat(str(1, name), msg(4, config("k_bool", int(5, 1))));
  const others = cat(int(1, 42), msg(2, part("20404GID1=2801")), msg(2, part("zain_iq")));

  it("splits into exact CarrierSettings messages", () => {
    const split = splitMultiCarrierSettings(others);
    expect(split.version).toBe("42");
    expect(split.settings).toEqual([part("20404GID1=2801"), part("zain_iq")]);
  });

  it("decodes each part as a CarrierSettings", () => {
    const settings = splitMultiCarrierSettings(others).settings.map(decodeCarrierSettings);
    expect(settings.map((s) => s.canonicalName)).toEqual(["20404GID1=2801", "zain_iq"]);
    expect(settings[1]?.configs).toEqual({ k_bool: { kind: "bool", value: true } });
  });
});

describe("decodeCarrierList", () => {
  it("decodes entries with their MVNO oneof, the last member winning", () => {
    const list = decodeCarrierList(cat(
      msg(1, str(1, "tmobile_us"), msg(2, str(1, "310260")), msg(2, str(1, "310260"), str(2, "Mint"), str(4, "6D"))),
      msg(1, str(1, "x_us"), msg(2, str(1, "310999"), str(3, "31099912xx"), int(5, 1))),
      int(2, 7),
    ));
    expect(list.version).toBe("7");
    expect(list.entries).toEqual([
      { canonicalName: "tmobile_us", carrierIds: [{ mccMnc: "310260" }, { mccMnc: "310260", mvno: { kind: "gid1", value: "6D" } }] },
      { canonicalName: "x_us", carrierIds: [{ mccMnc: "310999", mvno: { kind: "imsi", value: "31099912xx" } }] },
    ]);
    expect(list.unknown).toEqual([{ path: "entries[1].carrierIds[0]", field: 5, wire: "varint", value: "1" }]);
  });
});

describe("configDoc", () => {
  it("documents CarrierConfigManager keys, nested classes and service keys", () => {
    expect(configDoc("carrier_volte_available_bool")).toMatchObject({ constant: "KEY_CARRIER_VOLTE_AVAILABLE_BOOL", type: "bool", default: "false" });
    expect(configDoc("ims.sip_timer_t1_millis_int")).toMatchObject({ constant: "Ims.KEY_SIP_TIMER_T1_MILLIS_INT", type: "int", since: 33 });
    expect(configDoc("qns.sos_transport_type_int")?.type).toBe("int");
    expect(configDoc("iwlan.key_error_policy_config_string")?.type).toBe("string");
    expect(configDoc("no_such_key_bool")).toBeUndefined();
    expect(configDoc("constructor")).toBeUndefined();
  });
});

const corpus = process.env["CORPUS"] && join(process.env["CORPUS"], "android/CarrierSettings");
describe.runIf(corpus && existsSync(corpus))("corpus", () => {
  it("decodes every file, each named after its canonical name", () => {
    const dir = corpus || "";
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".pb"))) {
      const bytes = readFileSync(join(dir, name));
      if (name === "carrier_list.pb") expect(decodeCarrierList(bytes).entries.length).toBeGreaterThan(0);
      else if (name === "others.pb") expect(splitMultiCarrierSettings(bytes).settings.map(decodeCarrierSettings).length).toBeGreaterThan(0);
      else expect(`${decodeCarrierSettings(bytes).canonicalName}.pb`).toBe(name);
    }
  });
});
