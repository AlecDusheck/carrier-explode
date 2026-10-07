import { describe, expect, it } from "vitest";

import { modemDevices, osImagePath, parseBuildManifest } from "../src/index.ts";

const component = (path: string): string =>
	`<dict><key>Info</key><dict><key>Path</key><string>${path}</string></dict></dict>`;
const identity = (board: string, product: string, variant: string, parts: Record<string, string>): string =>
	`<dict><key>Ap,ProductType</key><string>${product}</string>` +
	`<key>Info</key><dict><key>DeviceClass</key><string>${board}</string><key>Variant</key><string>${variant}</string></dict>` +
	`<key>Manifest</key><dict>${Object.entries(parts)
		.map(([k, p]) => `<key>${k}</key>${component(p)}`)
		.join("")}</dict></dict>`;

/** iOS 27.0.1 for iPhone17,1 in miniature: two install identities, a recovery one with its own OS. */
const PLIST = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>ProductVersion</key><string>27.0.1</string>
<key>ProductBuildVersion</key><string>24A446</string>
<key>SupportedProductTypes</key><array><string>iPhone17,2</string><string>iPhone17,1</string></array>
<key>BuildIdentities</key><array>
${identity("D93AP", "iPhone17,1", "Customer Erase Install (IPSW)", { OS: "043-70165-666.dmg.aea", BasebandFirmware: "Firmware/Mav24-3.02.02.Release.bbfw", "Rap,RTKitOS": "Firmware/Rose/r2p1/ftab.bin" })}
${identity("D93AP", "iPhone17,1", "Customer Upgrade Install (IPSW)", { OS: "043-70165-666.dmg.aea", BasebandFirmware: "Firmware/Mav24-3.02.02.Release.bbfw" })}
${identity("D94AP", "iPhone17,2", "Customer Erase Install (IPSW)", { OS: "043-70165-666.dmg.aea", "Cellular1,RTKitOS": "Firmware/c4000v59/Release/patched/ftab.bin" })}
${identity("D93AP", "iPhone17,1", "Recovery Customer Install", { OS: "043-68523-763.dmg.aea" })}
</array></dict></plist>`);

describe("parseBuildManifest", () => {
	const m = parseBuildManifest(PLIST);

	it("reads version, build and phones, oldest first", () => {
		expect([m.version, m.build, m.devices]).toEqual(["27.0.1", "24A446", ["iPhone17,1", "iPhone17,2"]]);
		expect(m.identities.map((i) => [i.board, i.product])).toEqual([
			["d93ap", "iPhone17,1"],
			["d93ap", "iPhone17,1"],
			["d94ap", "iPhone17,2"],
			["d93ap", "iPhone17,1"],
		]);
	});

	it("finds the root filesystem image, not the recovery OS", () => {
		expect(osImagePath(m)).toBe("043-70165-666.dmg.aea");
	});

	it("refuses two different install images", () => {
		const two = new TextDecoder()
			.decode(PLIST)
			.replace(
				"Customer Upgrade Install (IPSW)</string></dict><key>Manifest</key><dict><key>OS</key>" +
					component("043-70165-666.dmg.aea"),
				"Customer Upgrade Install (IPSW)</string></dict><key>Manifest</key><dict><key>OS</key>" +
					component("other.dmg"),
			);
		expect(() => osImagePath(parseBuildManifest(new TextEncoder().encode(two)))).toThrow(/2 OS images/);
	});

	it("maps each modem package to the phones that use it, not Rose or Wi-Fi", () => {
		expect([...modemDevices(m)]).toEqual([
			["Firmware/Mav24-3.02.02.Release.bbfw", ["iPhone17,1"]],
			["Firmware/c4000v59/Release/patched/ftab.bin", ["iPhone17,2"]],
		]);
	});
});
