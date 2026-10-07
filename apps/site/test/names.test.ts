import { describe, it, expect } from "vitest";
import { compareVersions } from "@carrier-explode/decode-ios";
import { sameName, versionLabel } from "../src/lib/names.ts";

describe("compareVersions", () => {
	it("puts a beta below its release and above the one before", () => {
		const v = ["27.2", "27.1", "27.2 beta 10", "27.2 RC", "27.2 beta 2", "27.2.1"];
		expect(v.toSorted(compareVersions)).toEqual([
			"27.1",
			"27.2 beta 2",
			"27.2 beta 10",
			"27.2 RC",
			"27.2",
			"27.2.1",
		]);
	});

	it("still orders plain bundle builds numerically", () => {
		expect(["9.1", "58.1", "25.1"].toSorted(compareVersions)).toEqual(["9.1", "25.1", "58.1"]);
	});
});

describe("slugs and labels", () => {
	it("reads a version slug as words", () => {
		expect(versionLabel("72.0")).toBe("version 72.0");
		expect(versionLabel("64.1@23a341")).toBe("version 64.1 (build 23A341)");
		expect(versionLabel("50.1@2022-04-12")).toBe("version 50.1 (OTA 2022-04-12)");
		expect(versionLabel("79000000034")).toBe("version 79000000034");
		expect(versionLabel("settings")).toBe("settings");
	});
});

describe("carrier logos and flags", () => {
	it("picks the longest, then rightmost, rule an Apple bundle name holds", async () => {
		const { carrierLogo } = await import("../src/lib/carrierlogos.ts");
		const of = (name: string) => carrierLogo([`ios:carrier:${name}`]);
		expect(of("ATT_US")).toBe("att");
		expect(of("ATT_RedPocket_US")).toBe("red-pocket");
		expect(of("TMobile_MetroPCS_US")).toBe("metro-by-t-mobile");
		expect(of("Cellcom_il")).not.toBe(of("CellcomWI_LTE_US"));
		expect(of("Nonexistent_Carrier")).toBeUndefined();
	});

	it("gives every source of a carrier its Apple bundle's logo, and none from an Android name", async () => {
		const { carrierLogo } = await import("../src/lib/carrierlogos.ts");
		expect(carrierLogo(["android:carrier:att_us", "ios:carrier:ATT_US"])).toBe("att");
		expect(carrierLogo(["android:carrier:ATT"])).toBeUndefined();
	});

	it("names a brand's logo by its longest, then rightmost, run of words", async () => {
		const { brandLogo, brandNames } = await import("../src/lib/carrierlogos.ts");
		expect(brandLogo("Odido")).toBe("odido");
		expect(brandLogo("Orange BF")).toBe("orange");
		expect(brandLogo("AT&T FirstNet")).toBe("firstnet");
		expect(brandLogo("T-Mobile")).toBe("t-mobile");
		expect(brandLogo("No Such Carrier")).toBeUndefined();
		expect(brandNames("AT&T FirstNet", "firstnet")).toBe(true);
		expect(brandNames("Odido", "orange")).toBe(false);
	});

	it("turns an ISO code into its flag", async () => {
		const { flag } = await import("../src/lib/names.ts");
		expect(flag("us")).toBe("🇺🇸");
		expect(flag("zz")).toBeUndefined();
	});
});

describe("sameName", () => {
	it("hides a file name that only adds a country suffix or spelling to the brand", () => {
		expect([
			sameName("T-Mobile", "tmobile_us"),
			sameName("A1", "a1_at"),
			sameName("A1", "bob_at"),
			sameName("1GLOBAL", "truphone_us"),
			sameName("中国联通", "46001"),
		]).toEqual([true, true, false, false, false]);
	});
});
