/**
 * The per-platform view registry: what a native view (/<group>/<id>/<platform>/<source>/<version>/<tab>)
 * shows on each platform. Routes and the shared header look a platform up
 * here instead of branching on it, so a platform's views live in its own
 * folder and nowhere else.
 */

import type { Component } from "svelte";
import type { Platform } from "#lib/schema/types.ts";
import type { NativeAt, TabProps } from "#lib/types.ts";
import IosTabs from "./ios/tabs/IosTabs.svelte";
import IosOverview from "./ios/tabs/Overview.svelte";
import IosSettings from "./ios/tabs/Settings.svelte";
import IosModem from "./ios/tabs/Modem.svelte";
import IosFiles from "./ios/tabs/Files.svelte";
import IosChanges from "./ios/tabs/Changes.svelte";
import IosAlerts from "./ios/tabs/Alerts.svelte";
import AndroidTabs from "./android/AndroidTabs.svelte";
import AndroidOverview from "./android/Overview.svelte";
import AndroidSettings from "./android/Settings.svelte";
import AndroidApns from "./android/Apns.svelte";
import AndroidRaw from "./android/Raw.svelte";
import AndroidChanges from "./android/Changes.svelte";

export interface TabView {
  readonly body: Component<TabProps>;
  /** Takes a file path after the tab (`files/carrier.plist`); other tabs 404 on one. */
  readonly takesPath?: true;
}

export interface PlatformView {
  /** The tab row; which tabs it shows can depend on what the version holds. */
  readonly Tabs: Component<{ at: NativeAt; tab: string }>;
  /** By tab segment; "" is the version's overview. */
  readonly tabs: Readonly<Record<string, TabView>>;
  /** Old tab names, redirected to the current ones. */
  readonly aliases: Readonly<Record<string, string>>;
}

export const VIEWS = {
  ios: {
    Tabs: IosTabs,
    tabs: {
      "": { body: IosOverview },
      settings: { body: IosSettings },
      modem: { body: IosModem },
      files: { body: IosFiles, takesPath: true },
      changes: { body: IosChanges },
      alerts: { body: IosAlerts },
    },
    aliases: { plist: "settings", strings: "settings", assets: "files", baseband: "modem" },
  },
  android: {
    Tabs: AndroidTabs,
    tabs: {
      "": { body: AndroidOverview },
      settings: { body: AndroidSettings },
      apns: { body: AndroidApns },
      raw: { body: AndroidRaw },
      changes: { body: AndroidChanges },
    },
    aliases: {},
  },
} as const satisfies Record<Platform, PlatformView>;

/** A tab of a platform, or undefined when the platform has none by that name. */
export function tabView(platform: Platform, tab: string): TabView | undefined {
  const tabs: Readonly<Record<string, TabView>> = VIEWS[platform].tabs;
  return Object.hasOwn(tabs, tab) ? tabs[tab] : undefined;
}

/** The current name of a tab, when `tab` is an old one. */
export function tabAlias(platform: Platform, tab: string): string | undefined {
  const aliases: Readonly<Record<string, string>> = VIEWS[platform].aliases;
  return Object.hasOwn(aliases, tab) ? aliases[tab] : undefined;
}
