/** What a source's version shows on each platform; routes look a platform up here instead of branching on it. */

import type { Component } from "svelte";
import type { ListedRelease } from "@carrier-explode/db";
import type { DecoderFamily, Platform, ReleasePlatform, SourceKind } from "@carrier-explode/schema/types";
import type { ModemTab, Tab } from "../../params.ts";
import type { PhoneRow } from "#lib/apple/phones.ts";
import type { NativeComparison } from "#lib/server/compare.ts";
import type { At, TabProps } from "#lib/types.ts";
import type { Loaded } from "./values/registry.ts";
import AppleOverview from "./ios/tabs/Overview.svelte";
import AppleSettings from "./ios/tabs/Settings.svelte";
import AppleModem from "./ios/tabs/Modem.svelte";
import AppleFiles from "./ios/tabs/Files.svelte";
import AppleChanges from "./ios/tabs/Changes.svelte";
import AppleAlerts from "./ios/tabs/Alerts.svelte";
import AndroidOverview from "./android/Overview.svelte";
import AndroidSettings from "./android/Settings.svelte";
import AndroidApns from "./android/Apns.svelte";
import AndroidModem from "./android/Modem.svelte";
import AndroidFiles from "./android/Files.svelte";
import AndroidChanges from "./android/Changes.svelte";
import AndroidReleaseName from "./android/ReleaseName.svelte";
import AndroidBuildTable from "./android/BuildTable.svelte";
import AppleBuildTable from "./ios/BuildTable.svelte";
import AppleModemHead from "./ios/modem/Head.svelte";
import AppleModemOverview from "./ios/modem/Overview.svelte";
import AppleModemCarriers from "./ios/modem/Carriers.svelte";
import AppleModemPolicy from "./ios/modem/Policy.svelte";
import AppleModemNetworks from "./ios/modem/Networks.svelte";
import AppleModemConfigs from "./ios/modem/Configs.svelte";
import AppleModemChanges from "./ios/modem/Changes.svelte";
import AndroidModemHead from "./android/modem/Head.svelte";
import AndroidModemOverview from "./android/modem/Overview.svelte";
import AppleReleasePicker from "./ios/ReleasePicker.svelte";
import ApplePhoneChoice from "./ios/PhoneChoice.svelte";
import AppleOverviewChoice from "./ios/OverviewChoice.svelte";
import AppleCompare from "./ios/Compare.svelte";
import AndroidCompare from "./android/Compare.svelte";
import { tabPhoneRows } from "./ios/phone-rows.ts";
import { appleHolds } from "./ios/tabs/holds.ts";
import { androidHolds } from "./android/holds.ts";
import SamsungOverview from "./samsung/Overview.svelte";
import SamsungSettings from "./samsung/Settings.svelte";
import SamsungApns from "./samsung/Apns.svelte";
import SamsungFiles from "./samsung/Files.svelte";
import SamsungChanges from "./samsung/Changes.svelte";
import SamsungCompare from "./samsung/Compare.svelte";
import SamsungBuildTable from "./samsung/BuildTable.svelte";
import { samsungHolds } from "./samsung/holds.ts";

export interface TabView {
	/** What the tab row calls it. */
	readonly label: string;
	readonly body: Component<TabProps>;
	/** Takes a file path after the tab (`files/carrier.plist`). */
	readonly takesPath: boolean;
	/** Shows the version strip: a tab whose content is not per version (Apple's alerts) has none. */
	readonly versioned: boolean;
	/** The choice the tab adds after the version: Apple's phone, on tabs that show one phone's file. */
	readonly Choice: Component<{ at: At; tab: Tab }> | null;
}

/** What a version has for each tab: a count to show beside its label, true to show it, false (or nothing) to leave it out. */
export type Holds = Readonly<Partial<Record<Tab, number | boolean>>>;

export interface PlatformView {
	readonly Overview: Component<TabProps>;
	/** The phone the Overview's features are for, when the line does not name one. */
	readonly OverviewChoice: Component<{ at: At }> | null;
	readonly tabs: Readonly<Partial<Record<Tab, TabView>>>;
	readonly holds: (at: At) => Promise<Holds>;
}

const tab = (
	label: string,
	body: Component<TabProps>,
	{
		takesPath = false,
		versioned = true,
		Choice = null,
	}: Partial<Pick<TabView, "takesPath" | "versioned" | "Choice">> = {},
): TabView => ({ label, body, takesPath, versioned, Choice });

const apple: PlatformView = {
	Overview: AppleOverview,
	OverviewChoice: AppleOverviewChoice,
	tabs: {
		alerts: tab("Emergency alerts", AppleAlerts, { versioned: false }),
		settings: tab("Settings", AppleSettings, { Choice: ApplePhoneChoice }),
		modem: tab("Modem", AppleModem, { Choice: ApplePhoneChoice }),
		files: tab("Files", AppleFiles, { takesPath: true }),
		changes: tab("Changes", AppleChanges),
	},
	holds: appleHolds,
};

const android: PlatformView = {
	Overview: AndroidOverview,
	OverviewChoice: null,
	tabs: {
		settings: tab("Settings", AndroidSettings),
		apns: tab("APNs", AndroidApns),
		modem: tab("Modem", AndroidModem),
		files: tab("Files", AndroidFiles, { takesPath: true }),
		changes: tab("Changes", AndroidChanges),
	},
	holds: androidHolds,
};

/** A Galaxy pack's tabs: its settings, feature switches and IMS settings; customer.xml's data profiles; its files decoded; its changes. */
const samsung: PlatformView = {
	Overview: SamsungOverview,
	OverviewChoice: null,
	tabs: {
		settings: tab("Settings", SamsungSettings),
		apns: tab("APNs", SamsungApns),
		files: tab("Files", SamsungFiles, { takesPath: true }),
		changes: tab("Changes", SamsungChanges),
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
export interface ModemProps<P extends ReleasePlatform = ReleasePlatform> {
	readonly platform: P;
	readonly build: string;
	readonly modem: string;
}

interface ModemTabView {
	readonly body: Component<ModemProps & { path: string }>;
	/** What may follow the tab (a file's index); null for nothing. */
	readonly path: RegExp | null;
}

type SummaryOf<P extends ReleasePlatform> = Extract<ListedRelease, { readonly platform: P }>;

interface ReleaseView<P extends ReleasePlatform> {
	/** The platform's builds on the builds page. */
	readonly Table: Component<{ builds: readonly SummaryOf<P>[] }>;
	/** What names the build at the top of its page. */
	readonly Name: Component<{ release: ListedRelease }>;
	/** The modems the build ships: what they are called, and what to say of them; null where no modem is read. */
	readonly modems: { readonly title: string; readonly note: string | null; readonly none: string } | null;
	/** A modem's pages: its head, its overview, and its tabs. */
	readonly modem: {
		readonly Head: Component<ModemProps<P> & { tab: ModemTab | "" }>;
		readonly Overview: Component<ModemProps<P>>;
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
		Table: AppleBuildTable,
		Name: AppleReleasePicker,
		modems: {
			title: "Modem packages",
			note: "The modem defaults each iPhone starts from before its carrier bundle's modem file.",
			none: "No modem packages extracted from this image yet.",
		},
		modem: {
			Head: AppleModemHead,
			Overview: AppleModemOverview,
			tabs: {
				carriers: { body: AppleModemCarriers, path: null },
				policy: { body: AppleModemPolicy, path: /^\d{1,6}$/ },
				networks: { body: AppleModemNetworks, path: null },
				configs: { body: AppleModemConfigs, path: null },
				changes: { body: AppleModemChanges, path: null },
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
		Table: AndroidBuildTable,
		Name: AndroidReleaseName,
		modems: { title: "Modems", note: null, none: "No modem firmware extracted from this build yet." },
		modem: { Head: AndroidModemHead, Overview: AndroidModemOverview, tabs: {} },
		kinds: [
			{ kind: "carrier", title: "Carrier settings", unchanged: null },
			{ kind: "default", title: "Defaults", unchanged: null },
		],
		column: "Source",
		unchanged: "No carrier settings changes.",
		shipped: null,
	},
	samsung: {
		Table: SamsungBuildTable,
		Name: AndroidReleaseName,
		modems: {
			title: "Modems",
			note: null,
			none: "No modem read: this firmware's Exynos modem is encrypted.",
		},
		modem: { Head: AndroidModemHead, Overview: AndroidModemOverview, tabs: {} },
		kinds: [{ kind: "carrier", title: "Carrier packs", unchanged: null }],
		column: "Pack",
		unchanged: "No carrier pack changes.",
		shipped: "Packs",
	},
};

const ofPlatform =
	<P extends ReleasePlatform>(platform: P) =>
	(r: ListedRelease): r is SummaryOf<P> =>
		r.platform === platform;

/** A platform's builds among all of them, with the table that lists them. */
export const buildTable = <P extends ReleasePlatform>(
	platform: P,
	all: readonly ListedRelease[],
): Loaded<{ builds: readonly SummaryOf<P>[] }> => ({
	View: RELEASE_VIEWS[platform].Table,
	props: { builds: all.filter(ofPlatform(platform)) },
});

/** How /compare shows two sources of one family. */
interface CompareView<F extends DecoderFamily> {
	readonly Native: Component<{ comparison: NativeComparison<F> }>;
	/** Whether the comparison can be narrowed to one file by its path. */
	readonly byFile: boolean;
	/** The phones a side can be seen by, each naming its variant by `path`: Apple's override files. */
	readonly variants: (at: At) => Promise<PhoneRow[]>;
}

export const COMPARE_VIEWS: { readonly [F in DecoderFamily]: CompareView<F> } = {
	apple: { Native: AppleCompare, byFile: true, variants: (at) => tabPhoneRows(at, "settings") },
	android: { Native: AndroidCompare, byFile: false, variants: async () => [] },
	samsung: { Native: SamsungCompare, byFile: false, variants: async () => [] },
};

/** A native comparison with the view that shows it. */
export const nativeView = <F extends DecoderFamily>(
	comparison: NativeComparison<F> & { readonly family: F },
): Loaded<{ comparison: NativeComparison<F> }> => ({
	View: COMPARE_VIEWS[comparison.family].Native,
	props: { comparison },
});

/** A platform's modem views, typed by it: RELEASE_VIEWS indexed by a generic platform keeps the two together. */
export const modemView = <P extends ReleasePlatform>(platform: P): ReleaseView<P>["modem"] =>
	RELEASE_VIEWS[platform].modem;

/** A modem tab's view on a platform, when it has the tab. */
export const modemTabView = (platform: ReleasePlatform, which: ModemTab): ModemTabView | undefined =>
	RELEASE_VIEWS[platform].modem.tabs[which];
