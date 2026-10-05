/** Structured CarrierConfig values, on strings from Pixel CarrierSettings (verizon_us, ee_gb) and CarrierConfigManager's javadoc. */

import { describe, expect, it } from "vitest";
import { readConfigValue, type ConfigFormat } from "../src/index.ts";

/** The decoded value, after checking it decoded in `format`. */
function decoded(format: ConfigFormat, key: string, value: unknown): unknown {
  const r = readConfigValue(key, value);
  if (r?.kind !== "decoded" || r.decoded.format !== format) throw new Error(`${key} did not decode as ${format}: ${JSON.stringify(r)}`);
  return r.decoded.value;
}

describe("readConfigValue", () => {
  it("leaves a key without a format alone", () => {
    expect(readConfigValue("carrier_volte_available_bool", true)).toBeNull();
  });

  it("says why a whole value is not understood", () => {
    expect(readConfigValue("iwlan_handover_policy_string_array", "source=IWLAN")).toEqual({ kind: "not-understood", reason: "not a string array" });
    expect(readConfigValue("lte_rsrp_thresholds_int_array", [-115, -105, -95])).toEqual({ kind: "not-understood", reason: "3 thresholds, not 4" });
  });

  it("reads handover rules as DataNetworkController.HandoverRule does", () => {
    const rules = decoded("handover-rules", "iwlan_handover_policy_string_array", [
      "source=GERAN|UTRAN|EUTRAN|NGRAN|IWLAN|UNKNOWN, target=GERAN|UTRAN|EUTRAN|NGRAN|IWLAN, roaming=true, type=disallowed, capabilities=IMS|EIMS|MMS|XCAP|CBS",
      "source=EUTRAN|NGRAN|IWLAN, target=EUTRAN|NGRAN|IWLAN, type=allowed, capabilities=IMS|MMS|XCAP|CBS",
      // CarrierConfigManager's own sample: `target:` is not key=value, so the platform drops it.
      "source=GERAN|UTRAN, target:IWLAN, type=disallowed",
      "source=EUTRAN, target=UTRAN, type=allowed",
    ]);
    expect(rules).toEqual([
      { ok: true, value: {
        type: "disallowed", source: ["GERAN", "UTRAN", "EUTRAN", "NGRAN", "IWLAN", "UNKNOWN"], target: ["GERAN", "UTRAN", "EUTRAN", "NGRAN", "IWLAN"],
        roamingOnly: true, capabilities: ["IMS", "EIMS", "MMS", "XCAP", "CBS"],
      } },
      { ok: true, value: { type: "allowed", source: ["EUTRAN", "NGRAN", "IWLAN"], target: ["EUTRAN", "NGRAN", "IWLAN"], roamingOnly: false, capabilities: ["IMS", "MMS", "XCAP", "CBS"] } },
      { ok: false, text: "source=GERAN|UTRAN, target:IWLAN, type=disallowed", reason: "\"target:iwlan\" is not key=value" },
      { ok: false, text: "source=EUTRAN, target=UTRAN, type=allowed", reason: "IWLAN on neither side" },
    ]);
  });

  it("reads setup retry rules as DataRetryManager.DataSetupRetryRule does", () => {
    const rules = decoded("retry-rules", "telephony_data_setup_retry_rules_string_array", [
      "capabilities=eims, retry_interval=1000, maximum_retries=20",
      "permanent_fail_causes=8|27|28|29|32|33|35|50|51|-5|-6|65538|-3, retry_interval=2500",
      "capabilities=mms|supl|cbs, retry_interval=2000",
    ]);
    expect(rules).toEqual([
      { capabilities: ["EIMS"], failCauses: [], permanent: false, intervalsMs: [1000], maxRetries: 20, ignored: [] },
      { capabilities: [], failCauses: [8, 27, 28, 29, 32, 33, 35, 50, 51, -5, -6, 65538, -3], permanent: true, intervalsMs: [2500], maxRetries: 10, ignored: [] },
      { capabilities: ["MMS", "SUPL", "CBS"], failCauses: [], permanent: false, intervalsMs: [2000], maxRetries: 10, ignored: [] },
    ].map((value) => ({ ok: true, value })));
  });

  it("reads the 5G icon and its grace periods as NetworkTypeController does", () => {
    expect(decoded("nr-icons", "5g_icon_configuration_string", "connected_mmwave:5G_Plus,connected:5G,not_restricted_rrc_idle:5G,bogus:5G")).toEqual([
      { ok: true, value: { state: "connected_mmwave", icon: "5G_Plus" } },
      { ok: true, value: { state: "connected", icon: "5G" } },
      { ok: true, value: { state: "not_restricted_rrc_idle", icon: "5G" } },
      { ok: false, text: "bogus:5G", reason: "unknown 5G state bogus" },
    ]);
    expect(decoded("nr-icon-timers", "5g_icon_display_grace_period_string", "connected_mmwave,any,3;not_restricted_rrc_idle,not_restricted_rrc_con,2")).toEqual([
      { ok: true, value: { from: "connected_mmwave", to: "any", seconds: 3 } },
      { ok: true, value: { from: "not_restricted_rrc_idle", to: "not_restricted_rrc_con", seconds: 2 } },
    ]);
  });

  it("names NR modes and keeps one it does not know", () => {
    expect(decoded("nr-modes", "carrier_nr_availabilities_int_array", [1, 2, 3])).toEqual([
      { ok: true, value: "NSA" }, { ok: true, value: "SA" }, { ok: false, text: "3", reason: "unknown mode 3" },
    ]);
  });

  it("reads signal thresholds within the javadoc's bounds", () => {
    expect(decoded("signal-levels", "5g_nr_ssrsrp_thresholds_int_array", [-115, -105, -95, -85]))
      .toEqual({ measure: "NR SS-RSRP", unit: "dBm", min: -140, max: -44, thresholds: [-115, -105, -95, -85] });
    expect(readConfigValue("lte_rsrq_thresholds_int_array", [-40, -15, -12, -9])).toEqual({ kind: "not-understood", reason: "a threshold outside [-34, 3]" });
  });

  it("reads ImsReasonInfo remaps with their wildcards", () => {
    expect(decoded("reason-remaps", "ims_reasoninfo_mapping_string_array", ["501|call completion elsewhere|1014", "*|Call is dropped due to Wi-Fi signal is degraded|1407", "510|x"])).toEqual([
      { ok: true, value: { from: 501, message: "call completion elsewhere", to: 1014 } },
      { ok: true, value: { from: null, message: "Call is dropped due to Wi-Fi signal is degraded", to: 1407 } },
      { ok: false, text: "510|x", reason: "not code|message|code" },
    ]);
  });

  it("reads certificate hashes and the packages they cover", () => {
    expect(decoded("certificates", "carrier_certificate_string_array", [
      "FF82050BF6BED1F152AC1A12DC83CACBAD401775161882872C6665FC5E15C8F2:com.verizon.mips.services",
      "e751e163e91e041382839556d31302db7058c44d9df1b5b27fc43bd8f0ee2bba",
    ])).toEqual([
      { ok: true, value: { digest: "SHA-256", hash: "FF82050BF6BED1F152AC1A12DC83CACBAD401775161882872C6665FC5E15C8F2", packages: ["com.verizon.mips.services"] } },
      { ok: true, value: { digest: "SHA-256", hash: "E751E163E91E041382839556D31302DB7058C44D9DF1B5B27FC43BD8F0EE2BBA", packages: [] } },
    ]);
  });
});
