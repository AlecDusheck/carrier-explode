/**
 * Title and description from the route and its codes' names, so the head survives a failed pane and is the same
 * for every visitor. Written for what people search: the file's name (`ATT_US.ipcc`) or the brand and a setting.
 */

import { countryName } from "@carrier-explode/schema";
import {
	isPlatform,
	isReleasePlatform,
	RELEASE_PLATFORMS,
	shipsKind,
	type Platform,
	type ReleasePlatform,
} from "@carrier-explode/schema/types";
import { androidBuildSeo } from "./android/seo";
import { iosBuildSeo } from "./apple/seo";
import { samsungBuildSeo } from "./samsung/seo";
import { deviceWords, featurePage } from "./feature-pages";
import type { Tab } from "../params";
import { versionLabel } from "./names";
import { PLATFORM_DEVICES } from "./platforms";
import type { PageNames } from "./types";

export const SITE = "carrier-explode";

/** The route's params, as SvelteKit types them: any may be absent. */
type Params = Readonly<
	Partial<
		Record<
			| "kind"
			| "platform"
			| "name"
			| "line"
			| "version"
			| "tab"
			| "path"
			| "build"
			| "modem"
			| "feature"
			| "iso",
			string | undefined
		>
	>
>;
type Meta = { title: string; description: string };

/** A build page's head, as its platform words it: title candidates longest first, and the terms its description lists when they fit. */
interface BuildMeta {
	readonly titles: readonly [string, ...string[]];
	readonly description: string;
	readonly terms?: readonly string[];
}

/** How a platform's builds are searched for. */
export interface BuildSeo {
	readonly index: Meta;
	/** `compared`: the page lists the build's source changes, which the oldest build held has none of. */
	readonly build: (build: string, release: string, compared: boolean) => BuildMeta;
	readonly modem: (build: string, release: string, modem: string, names: PageNames["modem"]) => BuildMeta;
}

const BUILD_SEO = {
	ios: iosBuildSeo,
	android: androidBuildSeo,
	samsung: samsungBuildSeo,
} as const satisfies Record<ReleasePlatform, BuildSeo>;

// Google shows about 60 characters of title and 155 of description, and
// " · carrier-explode" (18) is appended to every title.
const TITLE_MAX = 52;
const DESC_MAX = 160;

/** The first candidate that fits; the last one is used regardless. */
const fit = (max: number, first: string, ...rest: string[]): string =>
	[first, ...rest].find((o) => o.length <= max) ?? rest.at(-1) ?? first;

/** `head` then as many of `terms` as fit, in order, then `tail`. */
function listing(head: string, terms: readonly string[], tail = "."): string {
	for (let n = terms.length; n > 0; n--) {
		const t = terms.slice(0, n);
		const s = `${head}${t.slice(0, -1).join(", ")}${t.length > 1 ? " and " : ""}${t.at(-1)}${tail}`;
		if (s.length <= DESC_MAX) return s;
	}
	return fit(DESC_MAX, head.replace(/[:,]\s*$/, "") + tail, head.slice(0, DESC_MAX - 1) + "…");
}

// What people search a carrier bundle for, most asked first.
const CARRIER_TERMS = [
	"APN",
	"VoLTE",
	"5G",
	"Wi-Fi Calling",
	"MCC/MNC",
	"RCS",
	"hotspot",
	"MMS",
	"visual voicemail",
];
const WATCH_TERMS = ["LTE", "eSIM", "VoLTE", "Wi-Fi Calling", "APN", "MCC/MNC"];
const COUNTRY_TERMS = [
	"emergency alerts",
	"cell broadcast channels",
	"which alerts you can turn off",
	"emergency numbers",
];

interface Device {
	readonly device: string;
	readonly noun: string;
	readonly terms: readonly string[];
	/** The file names people paste into a search box. */
	readonly files: (name: string) => string;
	readonly history: string;
}

const appleFiles = (n: string): string => `${n}.bundle / ${n}.ipcc`;

/** The device a platform's settings are for, and the words its readers search with. */
const DEVICE = {
	ios: {
		device: PLATFORM_DEVICES.ios,
		noun: "carrier bundle",
		terms: CARRIER_TERMS,
		files: appleFiles,
		history: "every iOS version and beta",
	},
	ipados: {
		device: PLATFORM_DEVICES.ipados,
		noun: "iPad carrier bundle",
		terms: CARRIER_TERMS,
		files: appleFiles,
		history: "every iPadOS version",
	},
	watchos: {
		device: PLATFORM_DEVICES.watchos,
		noun: "Apple Watch carrier bundle",
		terms: WATCH_TERMS,
		files: appleFiles,
		history: "every watchOS version",
	},
	android: {
		device: PLATFORM_DEVICES.android,
		noun: "Pixel carrier settings",
		terms: CARRIER_TERMS,
		files: (n) => `${n}.pb`,
		history: "every Pixel build",
	},
	samsung: {
		device: PLATFORM_DEVICES.samsung,
		noun: "Samsung carrier pack",
		terms: CARRIER_TERMS,
		files: (n) => `${n}/customer.xml`,
		history: "every Galaxy firmware",
	},
} as const satisfies Record<Platform, Device>;

/**
 * `label`: what people call the source, null when nothing names it but the code the title already shows (`20209`).
 * `full`: the label with its country, or the country alone; null when neither is known.
 */
type Who = Device & { readonly name: string; readonly label: string | null; readonly full: string | null };

function who(p: Params, source: PageNames["source"]): Who {
	const name = p.name ?? "";
	const platform: Platform = p.platform !== undefined && isPlatform(p.platform) ? p.platform : "ios";
	const d: Device = DEVICE[platform];
	const label = source === null || source.brand === name ? null : source.brand;
	if (p.kind === "countries")
		return { ...d, name, label, full: label, noun: "country bundle", terms: COUNTRY_TERMS };
	const country = source?.country ?? null;
	if (label === null || country === null) return { ...d, name, label, full: label ?? country };
	// O2_Germany, TIM_Italy: the country is already in the name.
	return { ...d, name, label, full: label.endsWith(country) ? label : `${label} ${country}` };
}

/** `words` after `lead`, or `words` alone when there is no lead. */
const led = (lead: string | null, words: string): string => (lead === null ? words : `${lead} ${words}`);

/** Title candidates, those that need a label dropped when there is none. */
const candidates = (first: string, ...rest: ReadonlyArray<string | null>): [string, ...string[]] => [
	first,
	...rest.filter((t): t is string => t !== null),
];

// `what` runs straight into `terms` when there are any.
const TABS: Record<Tab, { title: string; what: string; terms?: string[] }> = {
	settings: {
		title: "settings",
		what: "every setting decoded, with each phone's overrides: ",
		terms: ["APN", "VoLTE", "5G", "Wi-Fi Calling", "what only this carrier sets"],
	},
	modem: {
		title: "modem settings",
		what: "modem overrides (.der.pri) per iPhone decoded into ",
		terms: ["NV items", "EFS paths", "band combos", "carrier configuration bitfields"],
	},
	alerts: {
		title: "emergency alerts",
		what: "emergency alert switches and ",
		terms: ["cell broadcast message IDs", "which alerts you can turn off", "alert titles"],
	},
	changes: { title: "what changed", what: "every setting changed since the version before, key by key" },
	files: { title: "files", what: "every file in the bundle" },
	apns: { title: "APNs", what: "every APN with its types and protocols" },
};

const isTab = (t: string): t is Tab => Object.hasOwn(TABS, t);

function bundle(p: Params, source: PageNames["source"]): Meta {
	const w = who(p, source);
	const n = w.name;

	if (p.version) {
		const v = versionLabel(p.version);

		if (p.path) {
			return {
				title: fit(TITLE_MAX, `${p.path} — ${n} ${v}`, `${p.path} — ${n}`, p.path),
				description: listing(
					`${p.path} from the ${led(w.full, w.noun)} (${n}, ${v}), decoded key by key`,
					[],
				),
			};
		}
		const t = p.tab !== undefined && isTab(p.tab) ? TABS[p.tab] : undefined;
		if (t) {
			return {
				title: fit(TITLE_MAX, `${n} ${t.title} — ${v}`, `${n} ${t.title}`, `${n} — ${t.title}`, n),
				description: listing(`${led(w.full, w.noun)} ${n}, ${v}: ${t.what}`, t.terms ?? []),
			};
		}
		return {
			title: fit(
				TITLE_MAX,
				...candidates(
					`${n} ${v} — ${led(w.label, w.noun)}`,
					w.label === null ? null : `${n} ${v} — ${w.label}`,
					`${n} ${v} — ${w.noun}`,
					`${n} ${v}`,
				),
			),
			description: listing(
				`${led(w.full, w.noun)} ${n} as shipped in ${v}, decoded: `,
				w.terms,
				", and what changed.",
			),
		};
	}

	return {
		title: fit(
			TITLE_MAX,
			...candidates(
				`${n} — ${led(w.full, w.noun)}`,
				`${n} — ${led(w.label, w.noun)}`,
				w.label === null ? null : `${n} — ${w.label}`,
				`${n} — ${w.noun}`,
				n,
			),
		),
		description: listing(
			p.kind === "countries"
				? `${led(w.full, w.device)} country bundle (${n}.bundle), decoded: `
				: `${led(w.full, w.device)} carrier settings from ${w.files(n)}, decoded: `,
			[...w.terms, w.history],
		),
	};
}

export function seo(id: string | null, p: Params, names: PageNames): Meta {
	if (p.name) return bundle(p, names.source);

	if (p.feature) {
		const f = featurePage(p.feature);
		if (f) {
			return {
				title: fit(
					TITLE_MAX,
					`Which carriers support ${f.name} on ${deviceWords(f.platforms, "and")}?`,
					`${f.name} on ${deviceWords(f.platforms, "and")}: carriers`,
					`${f.name}: carriers`,
					f.name,
				),
				description: fit(
					DESC_MAX,
					`Does your carrier support ${f.name} on your ${deviceWords(f.platforms, "or")}? Every carrier, checked for each model. ${f.what}`,
					`Does your carrier support ${f.name} on your ${deviceWords(f.platforms, "or")}? Every carrier, checked for each model.`,
				),
			};
		}
	}

	if (p.platform !== undefined && isReleasePlatform(p.platform) && p.build !== undefined) {
		const s = BUILD_SEO[p.platform];
		const release = names.release?.label ?? p.build;
		const m =
			p.modem === undefined
				? s.build(p.build, release, names.release?.compared ?? true)
				: s.modem(p.build, release, p.modem, names.modem);
		const [first, ...rest] = m.titles;
		return {
			title: fit(TITLE_MAX, first, ...rest),
			description: m.terms?.length ? listing(m.description, m.terms) : fit(DESC_MAX, m.description),
		};
	}

	const platform: Platform = p.platform !== undefined && isPlatform(p.platform) ? p.platform : "ios";
	if (id === "/[platform=platform]/builds" && isReleasePlatform(platform)) return BUILD_SEO[platform].index;
	const device = PLATFORM_DEVICES[platform];
	switch (id) {
		case "/[platform=platform]/[kind=kind]/[iso=iso]": {
			const country = (p.iso !== undefined ? countryName(p.iso) : undefined) ?? "a country";
			return {
				title: fit(TITLE_MAX, `${device} carrier settings in ${country}`, `Carriers in ${country}`),
				description: `Every ${device} carrier settings file for a carrier in ${country}, decoded: APN, VoLTE, 5G, Wi-Fi Calling and MCC/MNC.`,
			};
		}
		case "/[platform=platform]/[kind=kind]/others.pb":
			return {
				title: `${device} other SIM rules (others.pb)`,
				description: `The ${device} carrier settings in others.pb that have no carrier name, each named by the SIM rule that selects it.`,
			};
		case "/[platform=platform]/[kind=kind]":
			if (p.kind === "countries" && !shipsKind(platform, "country")) {
				return {
					title: `${device} carriers by country`,
					description: `Every ${device} carrier settings file, by the country of its carrier: APN, VoLTE, 5G, Wi-Fi Calling and MCC/MNC.`,
				};
			}
			return p.kind === "countries"
				? {
						title: `${device} country bundles (emergency alerts)`,
						description: `Every ${device} country bundle, decoded: emergency alert and cell broadcast settings, which alerts you can't turn off, and the carriers in each country.`,
					}
				: {
						title: fit(TITLE_MAX, `${device} carrier settings — all carriers`, `${device} carrier settings`),
						description: `Every ${DEVICE[platform].noun} for the ${device}, decoded: APN, VoLTE, 5G, Wi-Fi Calling and MCC/MNC for every carrier, side by side.`,
					};
		case "/features":
			return {
				title: `Carrier features by carrier, ${deviceWords(RELEASE_PLATFORMS, "and")}`,
				description: `Does your carrier support 5G Standalone, Voice over 5G, Wi-Fi Calling, RCS or satellite texting on your ${deviceWords(RELEASE_PLATFORMS, "or")}? Check every carrier, for your model.`,
			};
		case "/compare":
			return {
				title: "Compare carrier settings",
				description:
					"Diff two carrier bundles or Android carrier settings key by key, across carriers, versions or platforms.",
			};
		case "/wiki":
			return {
				title: "Carrier settings wiki: iOS and Android",
				description:
					"How iOS carrier bundles and Pixel carrier settings are built, matched to a SIM and delivered, and the modem configuration files that ship with them.",
			};
		default:
			return {
				title: "iPhone carrier bundles & carrier settings, decoded",
				description:
					"Browse and download every iPhone carrier bundle (.ipcc) and country bundle Apple ships, decoded: APN, VoLTE, 5G, Wi-Fi Calling, MCC/MNC, iOS betas.",
			};
	}
}

/** A JSON-LD `<script>` for `{@html}`; `<` is escaped so no string in the graph can close the tag. */
export function jsonLdScript(graph: readonly object[]): string {
	return `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, "\\u003c")}</script>`;
}
