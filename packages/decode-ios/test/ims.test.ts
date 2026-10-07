import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { openIpcc, decodeFile, decodedPlist } from "../src/bundle.ts";
import { IMS_ENUMS, TERMINATION_EVENTS, describeImsSetting, defaultEndReason } from "../src/ims.ts";
import { defined, record } from "./defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const carrierOf = (bundle: string) => {
	const b = openIpcc(new Uint8Array(readFileSync(join(here, "fixtures", bundle))));
	return record(decodedPlist(decodeFile(b, "carrier.plist")));
};

describe("legacy renames", () => {
	it("marks the lookup as renamed", () => {
		expect(describeImsSetting("RingbackTimer")).toMatchObject({
			key: "RingbackTimerSeconds",
			renamedFrom: "RingbackTimer",
		});
		expect(describeImsSetting("SipTimerT2")).toMatchObject({ key: "T2", default: 16000 });
		expect(defined(describeImsSetting("CountryOfOriginationForWifi")).values).toBe(
			IMS_ENUMS.CountryOfOriginationFormat,
		);
		expect(defined(describeImsSetting("RingbackTimerSeconds")).renamedFrom).toBeUndefined();
	});
});

describe("real bundle values", () => {
	it("every ATT_RedPocket IMSConfig.Signaling enum value is an allowed value", () => {
		const sig = record(record(carrierOf("watch-redpocket.ipcc").IMSConfig).Signaling);
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
		const sig = record(record(carrierOf("watch-redpocket.ipcc").IMSConfig).Signaling);
		for (const [k, v] of Object.entries(sig)) {
			const s = describeImsSetting(k, "Signaling");
			if (!s || s.section !== "Signaling") continue;
			if (s.type === "b") expect(typeof v, k).toBe("boolean");
			if (s.type === "i") expect(typeof v, k).toBe("number");
		}
	});
});

describe("call end reasons", () => {
	it("looks up defaults by name", () => {
		expect(defaultEndReason("TemporarilyUnavailable", true)).toEqual(["TemporarilyUnavailable", 480, 14]);
		expect(defaultEndReason("RejectedByUser", false)).toEqual([
			"RejectedByUser",
			486,
			0,
			"Call Rejected By User",
		]);
		// listed twice in the outgoing map (487 then 603); the first row wins
		expect(defined(defaultEndReason("CallCompletedElsewhere", false))[1]).toBe(487);
		expect(defined(defaultEndReason("CallCompletedElsewhere", true))[1]).toBe(200);
		expect(defaultEndReason("NotFound", true)).toBeUndefined();
	});

	it("ATT_RedPocket TerminationEvent values are ReasonCode names", () => {
		const inc = record(
			record(record(carrierOf("watch-redpocket.ipcc").IMSConfig).Signaling).IncomingCallEndReasons,
		);
		for (const e of Object.values(inc)) expect(TERMINATION_EVENTS).toContain(record(e).TerminationEvent);
	});
});
