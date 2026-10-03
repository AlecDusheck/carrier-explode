import { defineParams } from "@sveltejs/kit/params";
import { KINDS, type Kind } from "#lib/types.ts";

/** A bundle's tabs, as the URL names them; `/carriers/ATT_US/settings` means the current version's. */
export const TABS = ["settings", "modem", "files", "changes", "alerts"] as const;
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

export const params = defineParams({
  kind: (p): Kind | undefined => KINDS.find((k) => k === p),
  // Every version slug is "ota-<build>" or "ios-<iOS version>" (timeline.ts), so a tab name never is one.
  version: (p): string | undefined => (/^(ota|ios)-./.test(p) ? p : undefined),
  tab: (p): Tab | undefined => TABS.find((t) => t === p),
  feature: (p): FeatureSlug | undefined => FEATURE_SLUGS.find((f) => f === p),
});
