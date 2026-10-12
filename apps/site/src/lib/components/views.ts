/** What a source's version shows on each platform, each view imported when a page shows it; routes look a platform up here instead of branching on it. */

import type { ListedRelease } from "@carrier-explode/db";
import type { DecoderFamily, Platform, ReleasePlatform, SourceKind } from "@carrier-explode/schema/types";
import type { ModemTab, Tab } from "../../params.ts";
import type { PhoneRow } from "#lib/apple/phones.ts";
import type { ReleaseOf } from "#lib/naming.ts";
import type { NativeComparison } from "#lib/server/compare.ts";
import type { At, TabProps } from "#lib/types.ts";
import type { Lazy, Loaded } from "./values/registry.ts";
import { tabPhoneRows } from "./ios/phone-rows.ts";
import { appleHolds } from "./ios/tabs/holds.ts";
import { androidHolds } from "./android/holds.ts";
import { samsungHolds } from "./samsung/holds.ts";

export interface TabView {
	/** What the tab row calls it. */
	readonly label: string;
	readonly body: Lazy<TabProps>;
	/** Takes a file path after the tab (`files/carrier.plist`). */
	readonly takesPath: boolean;
	/** Shows the version strip: a tab whose content is not per version (Apple's alerts) has none. */
	readonly versioned: boolean;
	/** The choice the tab adds after the version: Apple's phone, on tabs that show one phone's file. */
	readonly Choice: Lazy<{ at: At; tab: Tab }> | null;
}

/** What a version has for each tab: a count to show beside its label, true to show it, false (or nothing) to leave it out. */
export type Holds = Readonly<Partial<Record<Tab, number | boolean>>>;

export interface PlatformView {
	readonly Overview: Lazy<TabProps>;
	/** The phone the Overview's features are for, when the line does not name one. */
	readonly OverviewChoice: Lazy<{ at: At }> | null;
	readonly tabs: Readonly<Partial<Record<Tab, TabView>>>;
	readonly holds: (at: At) => Promise<Holds>;
}

const tab = (
	label: string,
	body: Lazy<TabProps>,
	{
		takesPath = false,
		versioned = true,
		Choice = null,
	}: Partial<Pick<TabView, "takesPath" | "versioned" | "Choice">> = {},
): TabView => ({ label, body, takesPath, versioned, Choice });

const apple: PlatformView = {
	Overview: () => import("./ios/tabs/Overview.svelte"),
	OverviewChoice: () => import("./ios/OverviewChoice.svelte"),
	tabs: {
		alerts: tab("Emergency alerts", () => import("./ios/tabs/Alerts.svelte"), { versioned: false }),
		settings: tab("Settings", () => import("./ios/tabs/Settings.svelte"), {
			Choice: () => import("./ios/PhoneChoice.svelte"),
		}),
		modem: tab("Modem", () => import("./ios/tabs/Modem.svelte"), {
			Choice: () => import("./ios/PhoneChoice.svelte"),
		}),
		files: tab("Files", () => import("./ios/tabs/Files.svelte"), { takesPath: true }),
		changes: tab("Changes", () => import("./ios/tabs/Changes.svelte")),
	},
	holds: appleHolds,
};

const android: PlatformView = {
	Overview: () => import("./android/Overview.svelte"),
	OverviewChoice: null,
	tabs: {
		settings: tab("Settings", () => import("./android/Settings.svelte")),
		apns: tab("APNs", () => import("./android/Apns.svelte")),
		modem: tab("Modem", () => import("./android/Modem.svelte")),
		files: tab("Files", () => import("./android/Files.svelte"), { takesPath: true }),
		changes: tab("Changes", () => import("./android/Changes.svelte")),
	},
	holds: androidHolds,
};

/** A Galaxy pack's tabs: its settings, feature switches and IMS settings; customer.xml's data profiles; its files decoded; its changes. */
const samsung: PlatformView = {
	Overview: () => import("./samsung/Overview.svelte"),
	OverviewChoice: null,
	tabs: {
		settings: tab("Settings", () => import("./samsung/Settings.svelte")),
		apns: tab("APNs", () => import("./samsung/Apns.svelte")),
		files: tab("Files", () => import("./samsung/Files.svelte"), { takesPath: true }),
		changes: tab("Changes", () => import("./samsung/Changes.svelte")),
	},
	holds: samsungHolds,
};

export const VIEWS = {
	ios: apple,
	ipados: apple,
	watchos: apple,
	android,
	samsung,
} as const satisfies Record<Platform, PlatformView>;

export const overviewChoice = (platform: Platform): PlatformView["OverviewChoice"] =>
	VIEWS[platform].OverviewChoice;

export const tabView = (platform: Platform, which: Tab): TabView | undefined => VIEWS[platform].tabs[which];

/** One kind of source on a build page: its section title, and the note when it has no changes (null: say nothing). */
interface ReleaseKind {
	readonly kind: SourceKind;
	readonly title: string;
	readonly unchanged: string | null;
}

/** What a modem's page is about: a build, and one of its modems by its BuildModem id. */
export type ModemProps<P extends ReleasePlatform = ReleasePlatform> = {
	readonly platform: P;
	readonly build: string;
	readonly modem: string;
};

interface ModemTabView {
	readonly body: Lazy<ModemProps & { path: string }>;
	/** What may follow the tab (a file's index); null for nothing. */
	readonly path: RegExp | null;
}

interface ReleaseView<P extends ReleasePlatform> {
	/** The platform's builds on the builds page. */
	readonly Table: Lazy<{ builds: readonly ReleaseOf<P>[] }>;
	/** What names the build at the top of its page. */
	readonly Name: Lazy<{ release: ListedRelease }>;
	/** The modems the build ships: what they are called, and what to say of them; null where no modem is read. */
	readonly modems: { readonly title: string; readonly note: string | null; readonly none: string } | null;
	/** A modem's pages: its head, its overview, and its tabs. */
	readonly modem: {
		readonly Head: Lazy<ModemProps<P> & { tab: ModemTab | "" }>;
		readonly Overview: Lazy<ModemProps<P>>;
		readonly tabs: Readonly<Partial<Record<ModemTab, ModemTabView>>>;
	};
	readonly kinds: readonly ReleaseKind[];
	/** The changed table's name column. */
	readonly column: string;
	/** Said when no kind changed. */
	readonly unchanged: string;
	/** The title of the table of every source the build ships; null where only its changes are listed. */
	readonly shipped: string | null;
}

export const RELEASE_VIEWS: { readonly [P in ReleasePlatform]: ReleaseView<P> } = {
	ios: {
		Table: () => import("./ios/BuildTable.svelte"),
		Name: () => import("./ios/ReleasePicker.svelte"),
		modems: {
			title: "Modem packages",
			note: "The modem defaults each iPhone starts from before its carrier bundle's modem file.",
			none: "No modem packages extracted from this image yet.",
		},
		modem: {
			Head: () => import("./ios/modem/Head.svelte"),
			Overview: () => import("./ios/modem/Overview.svelte"),
			tabs: {
				carriers: { body: () => import("./ios/modem/Carriers.svelte"), path: null },
				policy: { body: () => import("./ios/modem/Policy.svelte"), path: /^\d{1,6}$/ },
				networks: { body: () => import("./ios/modem/Networks.svelte"), path: null },
				configs: { body: () => import("./ios/modem/Configs.svelte"), path: null },
				changes: { body: () => import("./ios/modem/Changes.svelte"), path: null },
			},
		},
		kinds: [
			{ kind: "carrier", title: "Carrier bundles", unchanged: "No carrier bundle changes." },
			{ kind: "country", title: "Country bundles", unchanged: "No country bundle changes." },
		],
		column: "Bundle",
		unchanged: "No carrier or country bundle changes.",
		shipped: null,
	},
	android: {
		Table: () => import("./android/BuildTable.svelte"),
		Name: () => import("./android/ReleaseName.svelte"),
		modems: { title: "Modems", note: null, none: "No modem firmware extracted from this build yet." },
		modem: {
			Head: () => import("./android/modem/Head.svelte"),
			Overview: () => import("./android/modem/Overview.svelte"),
			tabs: {},
		},
		kinds: [
			{ kind: "carrier", title: "Carrier settings", unchanged: null },
			{ kind: "default", title: "Defaults", unchanged: null },
		],
		column: "Source",
		unchanged: "No carrier settings changes.",
		shipped: null,
	},
	samsung: {
		Table: () => import("./samsung/BuildTable.svelte"),
		Name: () => import("./android/ReleaseName.svelte"),
		modems: {
			title: "Modems",
			note: null,
			none: "No modem read: this firmware's Exynos modem is encrypted.",
		},
		modem: {
			Head: () => import("./android/modem/Head.svelte"),
			Overview: () => import("./android/modem/Overview.svelte"),
			tabs: {},
		},
		kinds: [{ kind: "carrier", title: "Carrier packs", unchanged: null }],
		column: "Pack",
		unchanged: "No carrier pack changes.",
		shipped: "Packs",
	},
};

const ofPlatform =
	<P extends ReleasePlatform>(platform: P) =>
	(r: ListedRelease): r is ReleaseOf<P> =>
		r.platform === platform;

/** A platform's builds among all of them, with the table that lists them. */
export const buildTable = async <P extends ReleasePlatform>(
	platform: P,
	all: readonly ListedRelease[],
): Promise<Loaded<{ builds: readonly ReleaseOf<P>[] }>> => ({
	View: (await RELEASE_VIEWS[platform].Table()).default,
	props: { builds: all.filter(ofPlatform(platform)) },
});

/** How /compare shows two sources of one family. */
interface CompareView<F extends DecoderFamily> {
	readonly Native: Lazy<{ comparison: NativeComparison<F> }>;
	/** Whether the comparison can be narrowed to one file by its path. */
	readonly byFile: boolean;
	/** The phones a side can be seen by, each naming its variant by `path`: Apple's override files. */
	readonly variants: (at: At) => Promise<PhoneRow[]>;
}

export const COMPARE_VIEWS: { readonly [F in DecoderFamily]: CompareView<F> } = {
	apple: {
		Native: () => import("./ios/Compare.svelte"),
		byFile: true,
		variants: (at) => tabPhoneRows(at, "settings"),
	},
	android: { Native: () => import("./android/Compare.svelte"), byFile: false, variants: async () => [] },
	samsung: { Native: () => import("./samsung/Compare.svelte"), byFile: false, variants: async () => [] },
};

/** A native comparison with the view that shows it. */
export const nativeView = async <F extends DecoderFamily>(
	comparison: NativeComparison<F> & { readonly family: F },
): Promise<Loaded<{ comparison: NativeComparison<F> }>> => ({
	View: (await COMPARE_VIEWS[comparison.family].Native()).default,
	props: { comparison },
});

/** A platform's modem views, typed by it: RELEASE_VIEWS indexed by a generic platform keeps the two together. */
export const modemView = <P extends ReleasePlatform>(platform: P): ReleaseView<P>["modem"] =>
	RELEASE_VIEWS[platform].modem;

/** A modem tab's view on a platform, when it has the tab. */
export const modemTabView = (platform: ReleasePlatform, which: ModemTab): ModemTabView | undefined =>
	RELEASE_VIEWS[platform].modem.tabs[which];
