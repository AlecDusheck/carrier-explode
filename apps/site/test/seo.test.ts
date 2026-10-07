import { describe, it, expect } from "vitest";
import { seo } from "../src/lib/seo.ts";
import { errorMessage } from "../src/lib/format.ts";
import type { PageNames } from "../src/lib/types.ts";

const NONE: PageNames = { source: null, modem: null, release: null };
const ATT = {
	source: { brand: "AT&T", country: "United States" },
	modem: null,
	release: null,
} satisfies PageNames;
const named = (brand: string, country: string | null): PageNames => ({
	source: { brand, country },
	modem: null,
	release: null,
});

const CASES: Array<[string, Parameters<typeof seo>[1]]> = [
	["/", {}],
	["/[platform=platform]/[kind=kind]", { kind: "carriers", platform: "ios" }],
	["/[platform=platform]/[kind=kind]", { kind: "countries", platform: "ios" }],
	["/[platform=platform]/[kind=kind]", { kind: "countries", platform: "android" }],
	["/[platform=platform]/[kind=kind]", { kind: "carriers", platform: "watchos" }],
	["/[platform=platform]/[kind=kind]/[name]", { kind: "carriers", platform: "ios", name: "ATT_US" }],
	[
		"/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]",
		{ kind: "carriers", platform: "ios", name: "ATT_US", version: "72.0" },
	],
	[
		"/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[tab=tab]/[...path]",
		{
			kind: "carriers",
			platform: "ios",
			name: "ATT_US",
			version: "72.0",
			tab: "files",
			path: "carrier.plist",
		},
	],
	["/compare", {}],
	["/[platform=platform]/builds", { platform: "ios" }],
	["/[platform=platform]/builds", { platform: "android" }],
	["/wiki", {}],
	["/[platform=platform]/builds/[build]", { platform: "ios", build: "24A437" }],
	["/[platform=platform]/builds/[build]", { platform: "ios", build: "24B5089g" }],
	["/[platform=platform]/builds/[build]/[modem]", { platform: "ios", build: "24A437", modem: "Mav25" }],
	["/[platform=platform]/builds/[build]/[modem]", { platform: "ios", build: "24A437", modem: "Mav21" }],
	["/[platform=platform]/builds/[build]/[modem]", { platform: "ios", build: "24A437", modem: "C1" }],
	["/[platform=platform]/builds/[build]/[modem]", { platform: "ios", build: "24B5089g", modem: "c4020" }],
	["/[platform=platform]/builds/[build]/[modem]", { platform: "ios", build: "24A437", modem: "ICE19" }],
	[
		"/[platform=platform]/[kind=kind]/[name]",
		{ kind: "carriers", platform: "watchos", name: "Verizon_LTE_US" },
	],
	[
		"/[platform=platform]/[kind=kind]/[name]",
		{ kind: "carriers", platform: "ios", name: "Verizon_Core_Visible_LTE_US" },
	],
	[
		"/[platform=platform]/[kind=kind]/[name]",
		{ kind: "countries", platform: "ios", name: "SaintHelenaAscensionAndTristanDaCunha" },
	],
	[
		"/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[tab=tab]/[...path]",
		{
			kind: "carriers",
			platform: "ios",
			name: "KDDI_BIGLOBE_LTE_only_jp",
			version: "72.7.2@24b5089g",
			tab: "modem",
			path: "",
		},
	],
	[
		"/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[tab=tab]/[...path]",
		{
			kind: "carriers",
			platform: "ios",
			name: "KDDI_BIGLOBE_LTE_only_jp",
			version: "72.7.2@24b5089g",
			tab: "settings",
			path: "",
		},
	],
	[
		"/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[tab=tab]/[...path]",
		{
			kind: "countries",
			platform: "ios",
			name: "SaintHelenaAscensionAndTristanDaCunha",
			version: "72.7.2@24b5089g",
			tab: "alerts",
			path: "",
		},
	],
	[
		"/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[tab=tab]/[...path]",
		{ kind: "carriers", platform: "ios", name: "ATT_US", version: "72.0", tab: "files", path: "" },
	],
	["/[platform=platform]/builds/[build]", { platform: "android", build: "CP3A.260905.009" }],
	[
		"/[platform=platform]/builds/[build]/[modem]",
		{ platform: "android", build: "CP3A.260905.009", modem: "tokay" },
	],
	["/[platform=platform]/[kind=kind]/[iso=iso]", { kind: "countries", platform: "android", iso: "us" }],
	[
		"/[platform=platform]/[kind=kind]/[name]/[[line=line]]",
		{ kind: "carriers", platform: "android", name: "tmobile_us", line: "tokay" },
	],
	[
		"/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[tab=tab]/[...path]",
		{
			kind: "carriers",
			platform: "android",
			name: "tmobile_us",
			line: "tokay",
			version: "79000000034",
			tab: "apns",
			path: "",
		},
	],
];

describe("seo", () => {
	it("gives every route a title and a description that survive a search result", () => {
		for (const [id, params] of CASES) {
			const { title, description } = seo(id, params, NONE);
			expect(title, id).toMatch(/\S/);
			// Google shows roughly 60 and 155 characters; " · carrier-explode" is appended to the title.
			expect(title.length + 18, id).toBeLessThanOrEqual(70);
			expect(description.length, id).toBeGreaterThan(50);
			expect(description.length, id).toBeLessThanOrEqual(160);
		}
	});

	it("titles a bundle with its file name and the brand people search for", () => {
		const p = { kind: "carriers", platform: "ios", name: "ATT_US", version: "72.0" };
		const title = (id: Parameters<typeof seo>[0], params: Parameters<typeof seo>[1]) =>
			seo(id, params, ATT).title;
		for (const t of ["ATT_US", "AT&T", "United States"])
			expect(
				title("/[platform=platform]/[kind=kind]/[name]", {
					kind: "carriers",
					platform: "ios",
					name: "ATT_US",
				}),
			).toContain(t);
		for (const t of ["ATT_US", "72.0", "AT&T"])
			expect(title("/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]", p)).toContain(
				t,
			);
		expect(
			title("/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[tab=tab]/[...path]", {
				...p,
				tab: "files",
				path: "carrier.plist",
			}),
		).toMatch(/^carrier\.plist .*ATT_US/);
		for (const t of ["UnitedStates", "United States"])
			expect(
				seo(
					"/[platform=platform]/[kind=kind]/[name]",
					{ kind: "countries", platform: "ios", name: "UnitedStates" },
					named("United States", "United States"),
				).title,
			).toContain(t);
	});

	it("carries both spellings of the name and the settings people search for", () => {
		const d = seo(
			"/[platform=platform]/[kind=kind]/[name]",
			{ kind: "carriers", platform: "ios", name: "RelianceJio_in" },
			named("Jio", "India"),
		).description;
		for (const term of [
			"Jio",
			"India",
			"RelianceJio_in.bundle",
			"RelianceJio_in.ipcc",
			"APN",
			"VoLTE",
			"5G",
			"Wi-Fi Calling",
		]) {
			expect(d).toContain(term);
		}
		expect(
			seo("/[platform=platform]/[kind=kind]", { kind: "carriers", platform: "ios" }, NONE).description,
		).toMatch(/\.ipcc|APN|VoLTE/);
		expect(
			seo("/[platform=platform]/[kind=kind]", { kind: "carriers", platform: "ios" }, NONE).description,
		).toContain("MCC/MNC");
	});

	it("names Android settings by their file, not an iPhone bundle", () => {
		const d = seo(
			"/[platform=platform]/[kind=kind]/[name]",
			{ kind: "carriers", platform: "android", name: "tmobile_us" },
			named("T-Mobile", "United States"),
		).description;
		expect(d).toContain("tmobile_us.pb");
		expect(d).toContain("Pixel");
		expect(d).not.toContain(".ipcc");
	});

	it("says a code nothing names once, with its country", () => {
		const p = { kind: "carriers", platform: "android", name: "20209" };
		const head = seo("/[platform=platform]/[kind=kind]/[name]", p, named("20209", "Greece"));
		expect(head.title).toBe("20209 — Greece Pixel carrier settings");
		expect(head.description).toMatch(/^Greece Pixel carrier settings from 20209/);
		const version = seo(
			"/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]",
			{ ...p, version: "79000000092" },
			named("20209", null),
		);
		expect(version.title.match(/20209/g)).toHaveLength(1);
	});

	it("keeps the brand when a long bundle name crowds the title", () => {
		const title = seo(
			"/[platform=platform]/[kind=kind]/[name]",
			{ kind: "carriers", platform: "ios", name: "TMobile_MetroPCS_US" },
			named("Metro by T-Mobile", "United States"),
		).title;
		expect(title).toContain("TMobile_MetroPCS_US");
		expect(title).toContain("Metro by T-Mobile");
	});

	it("names each tab and each kind of version", () => {
		const p = { kind: "carriers", platform: "ios", name: "ATT_US", version: "64.1@23a341" };
		const TAB = "/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[tab=tab]/[...path]";
		expect(
			seo("/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]", p, ATT).description,
		).toContain("version 64.1 (build 23A341)");
		expect(seo(TAB, { ...p, tab: "modem", path: "" }, ATT).title).toContain("modem");
		expect(seo(TAB, { ...p, tab: "settings", path: "" }, ATT).title).toContain("settings");
		expect(
			seo(TAB, { ...p, tab: "changes", path: "", version: "58.1@2024-03-05" }, ATT).description,
		).toContain("version 58.1 (OTA 2024-03-05)");
		expect(
			seo(
				"/[platform=platform]/builds/[build]",
				{ platform: "ios", build: "24B5089g" },
				{ ...NONE, release: { label: "iOS 27.2 beta 2", compared: true } },
			).title,
		).toMatch(/^iOS 27.2 beta 2 /);
		expect(
			seo("/[platform=platform]/builds/[build]", { platform: "android", build: "CP3A.260905.009" }, NONE)
				.title,
		).toBe("Pixel build CP3A.260905.009 carrier settings");
		const tokay = { ...NONE, modem: { label: "Google Tensor", phones: "Pixel 9 Pro" } };
		expect(
			seo(
				"/[platform=platform]/builds/[build]/[modem]",
				{ platform: "android", build: "CP3A.260905.009", modem: "tokay" },
				tokay,
			).title,
		).toMatch(/^Pixel 9 Pro modem/);
	});

	it("titles the oldest build held by its modems: its page lists no source changes", () => {
		const BUILD = "/[platform=platform]/builds/[build]";
		const first = (label: string): PageNames => ({ ...NONE, release: { label, compared: false } });
		const ios = seo(BUILD, { platform: "ios", build: "24B5099f" }, first("iOS 27.2 beta 3"));
		expect(ios.title).toBe("iOS 27.2 beta 3 (24B5099f) modem packages");
		expect(ios.description).not.toMatch(/bundle/);
		const pixel = seo(
			BUILD,
			{ platform: "android", build: "CP3A.260905.009" },
			first("Android 16 (2026-09)"),
		);
		expect(pixel.title).toBe("Pixel build CP3A.260905.009 modems");
	});
});

describe("errorMessage", () => {
	it("prefers what the error says", () => {
		expect(errorMessage({ body: { message: "no such file" }, status: 404 })).toBe("no such file");
		expect(errorMessage(new Error("boom"))).toBe("boom");
	});

	it("never renders a bare object as [object Object]", () => {
		expect(errorMessage({ status: 500, body: {} })).toContain("500");
		for (const e of [{ status: 500, body: {} }, {}]) expect(errorMessage(e)).not.toContain("[object Object]");
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		expect(() => errorMessage(loop)).not.toThrow();
	});
});
