/** Which phones a bundle configures for 5G: Apple shows the 5G switch (Show5GSwitch) only to a phone with a 5G radio. */

import { overrideBoards } from "@carrier-explode/decode-ios";
import type { Json } from "../types.ts";

export const FIVE_G_SWITCH = "Show5GSwitch";

/** Boards a bundle's override plists configure, and those of them it gives a 5G switch. */
export interface BoardRadios {
  readonly configured: readonly string[];
  readonly fiveG: readonly string[];
}

/** From a profile's raw leaves, keyed `overrides_D93_D94.plist:Show5GSwitch`. */
export function boardRadios(raw: Readonly<Record<string, Json>>): BoardRadios {
  const configured = new Set<string>(), fiveG = new Set<string>();
  for (const key of Object.keys(raw)) {
    const [file = "", path] = key.split(":", 2);
    const boards = file.endsWith(".plist") ? overrideBoards(file) : undefined;
    if (boards === undefined) continue;
    for (const b of boards) configured.add(b);
    if (path === FIVE_G_SWITCH) for (const b of boards) fiveG.add(b);
  }
  return { configured: [...configured], fiveG: [...fiveG] };
}
