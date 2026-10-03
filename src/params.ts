import { defineParams } from "@sveltejs/kit/params";

/**
 * Every tab a native view can have, on either platform, plus the old names that
 * redirect (plist, assets, baseband, strings). Which of them a platform offers
 * is its view registry's business (#lib/components/views.ts); the matcher only
 * keeps a tab name from being read as a source or a version.
 */
export const TABS = [
  "settings", "modem", "files", "changes", "alerts", "apns", "raw",
  "plist", "assets", "baseband", "strings",
] as const;
export type Tab = (typeof TABS)[number];

/**
 * The consumer feature pages (features.ts defines each one). Listed here because Node loads this
 * file on its own at build time, so it cannot import the decoders features.ts reads with.
 */
export const FEATURE_SLUGS = [
  "5g",
  "5g-standalone",
  "voice-over-5g",
  "volte",
  "hd-voice-plus",
  "wifi-calling",
  "calls-on-other-devices",
  "rcs",
  "rcs-business-messaging",
  "satellite",
  "visual-voicemail",
  "esim-transfer",
  "esim-from-android",
  "apple-watch-number-sharing",
  "branded-calling",
  "spam-call-warnings",
] as const;
export type FeatureSlug = (typeof FEATURE_SLUGS)[number];

/** Spelled out rather than imported: like FEATURE_SLUGS, this file is loaded on its own. */
const GROUPS = ["carriers", "countries"] as const;
const PLATFORMS = ["ios", "android"] as const;

export const params = defineParams({
  group: (p): (typeof GROUPS)[number] | undefined => GROUPS.find((g) => g === p),
  platform: (p): (typeof PLATFORMS)[number] | undefined => PLATFORMS.find((x) => x === p),
  // Every timeline slug starts with where it came from (an iOS image, an OTA file, an Android image), so a tab name never is one.
  version: (p): string | undefined => (/^(ota|ios|android)-./.test(p) ? p : undefined),
  tab: (p): Tab | undefined => TABS.find((t) => t === p),
  feature: (p): FeatureSlug | undefined => FEATURE_SLUGS.find((f) => f === p),
});
