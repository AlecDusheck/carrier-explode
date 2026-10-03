import { defineParams } from "@sveltejs/kit/params";
import { KINDS, type Kind } from "#lib/types.ts";

/** A bundle's tabs, as the URL names them; `/carriers/ATT_US/settings` means the current version's. */
export const TABS = ["settings", "modem", "files", "changes", "alerts"] as const;
export type Tab = (typeof TABS)[number];

export const params = defineParams({
  kind: (p): Kind | undefined => KINDS.find((k) => k === p),
  // Every version slug is "ota-<build>" or "ios-<iOS version>" (timeline.ts), so a tab name never is one.
  version: (p): string | undefined => (/^(ota|ios)-./.test(p) ? p : undefined),
  tab: (p): Tab | undefined => TABS.find((t) => t === p),
});
