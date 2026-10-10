import { describe, expect, it } from "vitest";
import { newestFirst, phonesOf, type DeviceCoverage, type NamedDevice } from "@carrier-explode/schema";
import { sourceKey, type ReleasePlatform } from "@carrier-explode/schema/types";
import { bestGuess, guessedVariant, type GuessInput } from "../src/lib/guess.ts";
import type { ModelChoice } from "../src/lib/phones.ts";

// Names as production's device labels give them (October 2026).
const DEVICES = {
	ios: [
		{ code: "iPhone19,2", name: "iPhone 18 Pro", released: "2026-09-18" },
		{ code: "iPhone19,3", name: "iPhone 18 Pro Max (US)", released: "2026-09-18" },
		{ code: "iPhone19,7", name: "iPhone 18 Pro Max", released: "2026-09-18" },
		{ code: "iPhone18,2", name: "iPhone 17 Pro Max", released: "2025-09-19" },
	],
	samsung: [
		{ code: "SM-S931B", name: "Galaxy S25 (SM-S931B)", released: "2025-02-07" },
		{ code: "SM-S931U", name: "Galaxy S25 (SM-S931U)", released: "2025-02-07" },
	],
	android: [
		{ code: "frankel", name: "Pixel 10", released: "2025-08" },
		{ code: "tokay", name: "Pixel 9", released: "2024-08" },
	],
} as const satisfies Record<ReleasePlatform, readonly NamedDevice[]>;

const COVERAGE: readonly DeviceCoverage[] = [
	{ device: "iPhone19,3", countries: ["us"], modem: null },
	{ device: "iPhone19,7", countries: ["us", "de", "gb"], modem: null },
	{ device: "SM-S931B", countries: ["de", "gb", "us"], modem: null },
	{ device: "SM-S931U", countries: ["us"], modem: null },
];

/** A platform's phones as the pickers offer them, newest first, every one covered. */
function phonesOn(platform: ReleasePlatform): Pick<GuessInput, "phones" | "models"> {
	const order = newestFirst(DEVICES[platform]);
	const devices = DEVICES[platform].toSorted((a, b) => order(a.code, b.code));
	const models: ModelChoice[] = phonesOf(platform, devices, COVERAGE).map((m) =>
		Object.assign(m, { platform, label: m.name }),
	);
	return { models, phones: devices.map((d) => Object.assign({ covered: true }, d)) };
}

// Each country's carrier bundles on iOS, as its country page orders them (by brand, then name), as production lists them.
const bundle = (name: string, brand: string, carrier: string) => ({
	key: sourceKey({ platform: "ios", kind: "carrier", name }),
	name,
	brand,
	carrier,
});
const LISTS: Readonly<Record<string, ReturnType<typeof bundle>[]>> = {
	us: [
		bundle("ATT_FirstNet_US", "AT&T", "ATT_FirstNet_US"),
		bundle("ATT_NR_US", "AT&T", "ATT_US"),
		bundle("ATT_US", "AT&T", "ATT_US"),
		bundle("TMobile_US", "T-Mobile", "TMB"),
		bundle("Verizon_LTE_US", "Verizon", "VZW"),
	],
	de: [bundle("o2_de", "O2", "o2_de"), bundle("TMobile_Germany", "Telekom", "TMobile_Germany")],
	gb: [bundle("TMobile_uk", "EE", "TMobile_uk"), bundle("vodafone_gb", "Vodafone", "vodafone_gb")],
};
const CARRIERS = [
	{ id: "ATT_US", name: "AT&T", iso: "us" },
	{ id: "ATT_FirstNet_US", name: "AT&T", iso: "us" },
	{ id: "TMB", name: "T-Mobile", iso: "us" },
	{ id: "VZW", name: "Verizon", iso: "us" },
	{ id: "o2_de", name: "O2", iso: "de" },
	{ id: "TMobile_Germany", name: "Telekom.de", iso: "de" },
	{ id: "TMobile_uk", name: "EE", iso: "gb" },
	{ id: "vodafone_gb", name: "vodafone UK", iso: "gb" },
];

const input = (
	device: GuessInput["device"],
	country: string | null,
	network: string | null,
	platform: ReleasePlatform,
): GuessInput => ({
	device,
	country,
	network,
	carriers: CARRIERS,
	local: country === null ? [] : (LISTS[country] ?? []),
	fallback: LISTS["us"] ?? [],
	...phonesOn(platform),
});

const guess = (
	device: GuessInput["device"],
	country: string | null,
	network: string | null,
	platform: ReleasePlatform,
) => {
	const i = input(device, country, network, platform);
	const g = bestGuess(i);
	return { g, variant: guessedVariant(i.models, g)?.code };
};
const ios = (name: string): string => sourceKey({ platform: "ios", kind: "carrier", name });

describe("bestGuess", () => {
	it("an iPhone in the US on AT&T: the newest iPhone's US variant, and AT&T's main bundle", () => {
		const { g, variant } = guess({ platform: "ios", model: undefined }, "us", "AT&T Mobility LLC", "ios");
		expect(g).toEqual({
			platform: "ios",
			phone: "iPhone 18 Pro Max (US)",
			country: "us",
			carrier: "AT&T",
			bundle: ios("ATT_US"),
			fromNetwork: true,
		});
		expect(variant).toBe("iPhone19,3");
	});

	it("a Galaxy reporting SM-S931B in Germany off a mobile network: its own phone, and Germany's first carrier", () => {
		const { g, variant } = guess({ platform: "samsung", model: "SM-S931B" }, "de", null, "samsung");
		expect(g).toMatchObject({
			phone: "Galaxy S25 (SM-S931B)",
			country: "de",
			carrier: "O2",
			fromNetwork: false,
		});
		expect(variant).toBe("SM-S931B");
	});

	it("a Pixel reporting its name in the UK on Vodafone: the Pixel of that name, and the UK's Vodafone", () => {
		const { g, variant } = guess(
			{ platform: "android", model: "Pixel 9" },
			"gb",
			"Vodafone Limited",
			"android",
		);
		expect(g).toMatchObject({ phone: "Pixel 9", country: "gb", carrier: "Vodafone", fromNetwork: true });
		expect(variant).toBe("tokay");
	});

	it("a desktop from an unknown country: the newest iPhone, and the US's first carrier, the one most of its bundles name", () => {
		const { g } = guess({ platform: null, model: undefined }, null, null, "ios");
		expect(g).toMatchObject({
			platform: "ios",
			phone: "iPhone 18 Pro Max (US)",
			carrier: "AT&T",
			bundle: ios("ATT_US"),
		});
	});

	it("a desktop in Germany: the newest iPhone's variant sold there", () => {
		expect(guess({ platform: null, model: undefined }, "de", null, "ios").g.phone).toBe("iPhone 18 Pro Max");
	});

	it("a Galaxy whose model the index lacks: the newest covered Galaxy's variant for the country", () => {
		expect(guess({ platform: "samsung", model: "SM-X999Z" }, "us", null, "samsung").g.phone).toBe(
			"Galaxy S25 (SM-S931U)",
		);
	});
});
