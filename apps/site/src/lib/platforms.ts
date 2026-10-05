/** How each platform, the device its settings are for, and its sources are named and pictured on a page. */

import type { AssetPath } from "$app/types";
import type { DecoderFamily, Platform } from "@carrier-explode/schema/types";

export const PLATFORM_NAMES = { ios: "iOS", ipados: "iPadOS", watchos: "watchOS", android: "Android" } as const satisfies Record<Platform, string>;

export const PLATFORM_DEVICES = { ios: "iPhone", ipados: "iPad", watchos: "Apple Watch", android: "Pixel" } as const satisfies Record<Platform, string>;

/** Each platform's device as a plain outline in static/phones. */
export const PLATFORM_DRAWINGS = {
  ios: "phones/iphone.svg",
  ipados: "phones/ipad.svg",
  watchos: "phones/watch.svg",
  android: "phones/pixel.svg",
} as const satisfies Record<Platform, `phones/${string}.svg`>;

/** What a platform's pages say first, where the site's coverage of it is thin. */
export const PLATFORM_NOTICES = {
  ios: null,
  android: null,
  ipados: "Work in progress: carrier-explode doesn't have the best coverage on iPadOS yet… we're working on it!",
  watchos: "Work in progress: carrier-explode doesn't have the best coverage on watchOS yet… we're working on it!",
} as const satisfies Record<Platform, string | null>;

/** The phones first; iPad and Watch bundles are a few dozen each. */
export const PLATFORM_ORDER = ["ios", "android", "ipados", "watchos"] as const satisfies readonly Platform[];

/** A version's major release, as the site writes versions: "27" of "27.2 beta 2", "16" of "16 QPR2". */
const major = (version: string | undefined): string | undefined => version?.split(/[ .]/)[0];

/** The releases with a mark in static/ios and static/android, drawn after the vendor's version icons; others get the plain tile. */
const IOS_MARKS = ["13", "14", "15", "16", "17", "18", "26", "27"] as const;
const ANDROID_MARKS = ["7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17"] as const;

const appleMark = (version: string | undefined): AssetPath => {
  const m = IOS_MARKS.find((x) => x === major(version));
  return m === undefined ? "ios/ios.svg" : `ios/${m}.svg`;
};

/** The mark beside a version of each platform. */
export const VERSION_MARKS = {
  ios: appleMark,
  ipados: appleMark,
  watchos: appleMark,
  android: (version) => {
    const m = ANDROID_MARKS.find((x) => x === major(version));
    return m === undefined ? "android/android.svg" : `android/${m}.svg`;
  },
} as const satisfies Record<Platform, (version: string | undefined) => AssetPath>;

/** What a family calls one of its sources, and the file a source's settings are read from. */
export const SOURCE_NOUNS = {
  apple: { one: "bundle", many: "bundles", settings: "carrier.plist" },
  android: { one: "source", many: "sources", settings: "CarrierConfig" },
} as const satisfies Record<DecoderFamily, { readonly one: string; readonly many: string; readonly settings: string }>;
