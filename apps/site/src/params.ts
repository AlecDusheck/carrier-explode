import { defineParams } from "@sveltejs/kit/params";
import {
	APPLE_PLATFORMS,
	FEATURE_SLUGS,
	isPlatform,
	isVersionSlug,
	KIND_SEGMENTS,
	type ApplePlatform,
	type FeatureSlug,
	type KindSegment,
	type Platform,
} from "@carrier-explode/schema";
import { ISO_CODE } from "@carrier-explode/schema/types";

/** A version's tabs on any platform, in the tab row's order; which a platform offers is its view registry's (#lib/components/views.ts). */
export const TABS = ["alerts", "settings", "apns", "modem", "files", "changes"] as const;
export type Tab = (typeof TABS)[number];

/** A build's modem's tabs on any platform; which a platform offers is RELEASE_VIEWS'. */
export const MODEM_TABS = ["carriers", "policy", "networks", "configs", "changes"] as const;
export type ModemTab = (typeof MODEM_TABS)[number];

export const params = defineParams({
	platform: (p): Platform | undefined => (isPlatform(p) ? p : undefined),
	/** The platforms whose bundles' raw files the pages embed. */
	appleplatform: (p): ApplePlatform | undefined => APPLE_PLATFORMS.find((a) => a === p),
	kind: (p): KindSegment | undefined => KIND_SEGMENTS.find((k) => k === p),
	version: (p): string | undefined => (isVersionSlug(p) ? p : undefined),
	// A line (a Pixel, a model) is whatever sits before a version and is neither a version nor a tab.
	line: (p): string | undefined => (!isVersionSlug(p) && !TABS.some((t) => t === p) ? p : undefined),
	tab: (p): Tab | undefined => TABS.find((t) => t === p),
	modemtab: (p): ModemTab | undefined => MODEM_TABS.find((t) => t === p),
	feature: (p): FeatureSlug | undefined => FEATURE_SLUGS.find((f) => f === p),
	/** A country code: a platform with no country files lists its carriers' countries by it. */
	iso: (p): string | undefined => (ISO_CODE.test(p) ? p : undefined),
});
