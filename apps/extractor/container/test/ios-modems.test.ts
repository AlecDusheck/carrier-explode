// An IPSW's modem packages (../src/jobs/ios/ipsw/modems.ts).

import { describe, expect, it } from "vitest";

import type { BuildManifest } from "@carrier-explode/decode-ios";
import { modemMembers, type MemberInfo } from "../src/jobs/ios/ipsw/modems.ts";

const zi = (name: string, size: number, crc32: number): MemberInfo => ({ name, size, crc32 });
const MAV25 = zi("Firmware/Mav25-2.10.01.Release.bbfw", 137531115, 0xade9fca3);
const C1 = zi("Firmware/c4000v59/Release/patched/ftab.bin", 208967425, 0x912e2e46);
const ROSE = zi("Firmware/Rose/r2p1/ftab.bin", 1069076, 0x36ef021f);
const T2026 = zi("Firmware/t2026phoneG1/Release/ftab.bin", 29455088, 0x0a662aa0);

/** One install identity per phone: product -> [(manifest key, IPSW path)]. */
const manifest = (products: Record<string, ReadonlyArray<readonly [string, string]>>): BuildManifest => ({
	version: "27.0",
	build: "24A437",
	devices: Object.keys(products),
	identities: Object.entries(products).map(([product, ents]) => ({
		board: "x",
		product,
		variant: "Customer Erase Install (IPSW)",
		paths: new Map(ents),
	})),
});

describe("modemMembers", () => {
	it("keeps only what the manifest names as a modem, with the phones each serves", () => {
		const m = manifest({
			"iPhone18,1": [
				["BasebandFirmware", MAV25.name],
				["Rap,RTKitOS", ROSE.name],
				["Wireless1,WiFiTx", T2026.name],
			],
			"iPhone18,4": [
				["Cellular1,RTKitOS", C1.name],
				["Cellular1,LLB", C1.name],
			],
		});
		const got = modemMembers([MAV25, ROSE, T2026, C1, zi("Firmware/all_flash/iBoot.im4p", 1, 1)], m);
		expect(got.map((x) => [x.name, x.kind, x.devices])).toEqual([
			["Mav25-2.10.01.Release.bbfw", "bbfw", ["iPhone18,1"]],
			["c4000v59/Release/patched/ftab.bin", "ftab", ["iPhone18,4"]],
		]);
		expect(got[0]?.crc32).toBe("ade9fca3");
		expect(got[1]?.member).toBe("Firmware/c4000v59/Release/patched/ftab.bin");
	});
});
