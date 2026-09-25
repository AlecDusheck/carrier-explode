import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { openIpcc, decodeFile } from "../src/lib/decode/bundle.ts";
import {
  IMS_ENUMS,
  IMS_RENAMES,
  IMS_SECTIONS,
  TERMINATION_EVENTS,
  DEFAULT_END_REASONS,
  DEFAULT_INCOMING_END_REASONS,
  imsSettings,
  describeImsSetting,
  defaultEndReason,
} from "../src/lib/decode/ims.ts";
import * as decode from "../src/lib/decode/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
type Dict = Record<string, unknown>;
const carrierOf = (bundle: string) => {
  const b = openIpcc(new Uint8Array(readFileSync(join(here, "fixtures", bundle))));
  return decodeFile(b, "carrier.plist").plist as Dict;
};

describe("IMS registry table", () => {
  const all = imsSettings();

  it("has 552 registrations in 12 sections", () => {
    expect(all).toHaveLength(552);
    expect([...IMS_SECTIONS].sort()).toEqual([
      "CallTransfer", "Cert", "ConferenceCalling", "IPTelephony", "Internal", "Lazuli",
      "Media", "Media/VoiceOnAP", "Signaling", "Signaling/SipTimers", "Voice", "XCAP",
    ]);
    const per = (sec: string) => all.filter((s) => s.section === sec).length;
    expect(per("Signaling")).toBe(343);
    expect(per("Media")).toBe(87);
    expect(per("Signaling/SipTimers")).toBe(20);
  });

  it("is unique per (section, key); only ImpuRank is registered twice", () => {
    const seen = new Set<string>();
    const dupKeys = new Map<string, number>();
    for (const s of all) {
      const id = `${s.section}/${s.key}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
      dupKeys.set(s.key, (dupKeys.get(s.key) ?? 0) + 1);
    }
    expect([...dupKeys].filter(([, n]) => n > 1).map(([k]) => k)).toEqual(["ImpuRank"]);
    expect(describeImsSetting("ImpuRank", "XCAP")!.section).toBe("XCAP");
    expect(describeImsSetting("ImpuRank", "Signaling")!.section).toBe("Signaling");
  });

  it("defaults match their declared type", () => {
    for (const s of all) {
      const d = s.default;
      if (s.type === "d") expect(d, s.key).toBeUndefined();
      if (d === undefined) continue;
      if (s.type === "b") expect(typeof d, s.key).toBe("boolean");
      if (s.type === "i") expect(Number.isInteger(d), s.key).toBe(true);
      if (s.type === "s" || s.type === "x" || s.type === "e" || s.type === "a") expect(typeof d, s.key).toBe("string");
      if (s.note !== undefined) expect(s.note.trim(), s.key).not.toBe("");
    }
  });

  it("enum keys are typed e and default to one of their values", () => {
    expect(Object.keys(IMS_ENUMS)).toHaveLength(10);
    for (const [key, values] of Object.entries(IMS_ENUMS)) {
      const s = describeImsSetting(key)!;
      expect(s.type, key).toBe("e");
      expect(s.values, key).toBe(values);
      expect(values, key).toContain(s.default);
      expect(values[0], key).toBe(s.default);
    }
    expect(all.filter((s) => s.type === "e").map((s) => s.key).sort()).toEqual(Object.keys(IMS_ENUMS).sort());
    expect(IMS_ENUMS.Preconditions).toEqual(["None", "Supported", "SupportedOptional", "SupportedButMandatory", "Required"]);
  });

  it("known compiled-in defaults", () => {
    expect(describeImsSetting("RingingTimerSeconds")).toMatchObject({ type: "i", default: 40, section: "Signaling" });
    expect(describeImsSetting("T1", "SipTimers")).toMatchObject({ default: 2000, section: "Signaling/SipTimers" });
    expect(describeImsSetting("UserAgentHeaderValue")).toMatchObject({ type: "x", default: "${OS}/${OS_VERSION} ${DEVICE}" });
    expect(describeImsSetting("SecurityAgreementEalgs")!.default).toBe("aes-cbc,null");
    expect(describeImsSetting("EnableAPOnlyMode", "VoiceOnAP")).toMatchObject({ default: true, section: "Media/VoiceOnAP" });
    expect(describeImsSetting("AudioCodecs")).toMatchObject({ type: "d", section: "Media" });
    expect(describeImsSetting("pcscf")!.section).toBe("IPTelephony");
    expect(describeImsSetting("NotAnImsKey")).toBeUndefined();
  });
});

describe("legacy renames", () => {
  it("has 51 renames onto registered keys", () => {
    expect(Object.keys(IMS_RENAMES)).toHaveLength(51);
    for (const [from, to] of Object.entries(IMS_RENAMES)) {
      expect(describeImsSetting(to), `${from} -> ${to}`).toBeTruthy();
      expect(describeImsSetting(from)!.key).toBe(to);
    }
  });

  it("marks the lookup as renamed", () => {
    expect(describeImsSetting("RingbackTimer")).toMatchObject({ key: "RingbackTimerSeconds", renamedFrom: "RingbackTimer" });
    expect(describeImsSetting("SipTimerT2")).toMatchObject({ key: "T2", default: 16000 });
    expect(describeImsSetting("CountryOfOriginationForWifi")!.values).toBe(IMS_ENUMS.CountryOfOriginationFormat);
    expect(describeImsSetting("RingbackTimerSeconds")!.renamedFrom).toBeUndefined();
  });
});

describe("real bundle values", () => {
  it("every ATT_RedPocket IMSConfig.Signaling enum value is an allowed value", () => {
    const sig = (carrierOf("ATT_RedPocket_Watch.ipcc").IMSConfig as Dict).Signaling as Dict;
    let checked = 0;
    for (const [k, v] of Object.entries(sig)) {
      const s = describeImsSetting(k, "Signaling");
      if (!s?.values) continue;
      expect(s.values, k).toContain(v);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it("booleans and integers in the bundle match the registry type", () => {
    const sig = (carrierOf("ATT_RedPocket_Watch.ipcc").IMSConfig as Dict).Signaling as Dict;
    for (const [k, v] of Object.entries(sig)) {
      const s = describeImsSetting(k, "Signaling");
      if (!s || s.section !== "Signaling") continue;
      if (s.type === "b") expect(typeof v, k).toBe("boolean");
      if (s.type === "i") expect(typeof v, k).toBe("number");
    }
  });
});

describe("call end reasons", () => {
  it("ReasonCode names 0-38", () => {
    expect(TERMINATION_EVENTS).toHaveLength(39);
    expect(TERMINATION_EVENTS[0]).toBe("LocalHangup");
    expect(TERMINATION_EVENTS[1]).toBe("RemoteHangup");
    expect(TERMINATION_EVENTS[38]).toBe("CallAudioServiceCrash");
    expect(new Set(TERMINATION_EVENTS).size).toBe(39);
  });

  it("default maps reference valid reason codes", () => {
    expect(DEFAULT_INCOMING_END_REASONS).toHaveLength(14);
    expect(DEFAULT_END_REASONS).toHaveLength(52);
    for (const [name, status, code] of [...DEFAULT_INCOMING_END_REASONS, ...DEFAULT_END_REASONS]) {
      expect(TERMINATION_EVENTS[code], name).toBeTruthy();
      expect(status === 0 || (status >= 200 && status < 700), name).toBe(true);
    }
  });

  it("looks up defaults by name", () => {
    expect(defaultEndReason("TemporarilyUnavailable", true)).toEqual(["TemporarilyUnavailable", 480, 14]);
    expect(defaultEndReason("RejectedByUser", false)).toEqual(["RejectedByUser", 486, 0, "Call Rejected By User"]);
    // listed twice in the outgoing map (487 then 603); the first row wins
    expect(defaultEndReason("CallCompletedElsewhere", false)![1]).toBe(487);
    expect(defaultEndReason("CallCompletedElsewhere", true)![1]).toBe(200);
    expect(defaultEndReason("NotFound", true)).toBeUndefined();
  });

  it("ATT_RedPocket TerminationEvent values are ReasonCode names", () => {
    const inc = ((carrierOf("ATT_RedPocket_Watch.ipcc").IMSConfig as Dict).Signaling as Dict).IncomingCallEndReasons as Record<string, Dict>;
    for (const e of Object.values(inc)) expect(TERMINATION_EVENTS).toContain(e.TerminationEvent);
  });
});

describe("barrel", () => {
  it("re-exports the IMS module", () => {
    expect(decode.describeImsSetting).toBe(describeImsSetting);
    expect(decode.IMS_RENAMES).toBe(IMS_RENAMES);
  });
});
