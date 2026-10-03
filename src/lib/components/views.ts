/**
 * What a source's version shows on each platform: its tab row and the body of
 * each tab. Routes and the bundle head look a platform up here instead of
 * branching on it. The three Apple platforms share one decoder and one set of views.
 */

import type { Component } from "svelte";
import type { Platform } from "#lib/schema/types.ts";
import type { At, TabProps } from "#lib/types.ts";
import AppleTabs from "./ios/tabs/IosTabs.svelte";
import AppleOverview from "./ios/tabs/Overview.svelte";
import AppleSettings from "./ios/tabs/Settings.svelte";
import AppleModem from "./ios/tabs/Modem.svelte";
import AppleFiles from "./ios/tabs/Files.svelte";
import AppleChanges from "./ios/tabs/Changes.svelte";
import AppleAlerts from "./ios/tabs/Alerts.svelte";
import AndroidTabs from "./android/AndroidTabs.svelte";
import AndroidOverview from "./android/Overview.svelte";
import AndroidSettings from "./android/Settings.svelte";
import AndroidApns from "./android/Apns.svelte";
import AndroidFiles from "./android/Files.svelte";
import AndroidChanges from "./android/Changes.svelte";

export interface TabView {
  readonly body: Component<TabProps>;
  /** Takes a file path after the tab (`files/carrier.plist`). */
  readonly takesPath: boolean;
}

export interface PlatformView {
  readonly Tabs: Component<{ at: At; tab: string }>;
  /** By tab segment; "" is the version's overview. */
  readonly tabs: Readonly<Record<string, TabView>>;
}

const tab = (body: Component<TabProps>, takesPath = false): TabView => ({ body, takesPath });

const apple: PlatformView = {
  Tabs: AppleTabs,
  tabs: {
    "": tab(AppleOverview),
    settings: tab(AppleSettings),
    modem: tab(AppleModem),
    files: tab(AppleFiles, true),
    changes: tab(AppleChanges),
    alerts: tab(AppleAlerts),
  },
};

const android: PlatformView = {
  Tabs: AndroidTabs,
  tabs: {
    "": tab(AndroidOverview),
    settings: tab(AndroidSettings),
    apns: tab(AndroidApns),
    files: tab(AndroidFiles),
    changes: tab(AndroidChanges),
  },
};

export const VIEWS = { ios: apple, ipados: apple, watchos: apple, android } as const satisfies Record<Platform, PlatformView>;

/** A platform's tab, or undefined when it has none by that name. */
export const tabView = (platform: Platform, name: string): TabView | undefined =>
  Object.hasOwn(VIEWS[platform].tabs, name) ? VIEWS[platform].tabs[name] : undefined;
