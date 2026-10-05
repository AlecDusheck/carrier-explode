/** What every platform's settings views share: how a SIM selects a source, rarity badges, and the words a filter matches. */

import type { SimMatcher } from "@carrier-explode/schema/types";
import type { KeyBadge } from "#lib/components/Tree.svelte";
import type { RareSetting } from "@carrier-explode/storage";

/** How a SIM gets this bundle: by MCC-MNC alone, an MCC-MNC plus GID or ICCID, an ICCID prefix, or a carrier ID. */
export interface SelectionRule {
  readonly via: string;
  readonly key: string;
  /** Which SIMs on that key it takes; null when the key alone decides. */
  readonly match: string | null;
}

/** A SIM rule as the selection tables show it: the PLMN it keys on, and what else a SIM must carry. */
export const simRule = (m: SimMatcher): SelectionRule => {
  const also = [
    m.gid1 !== undefined && `GID1 ${m.gid1}`,
    m.gid2 !== undefined && `GID2 ${m.gid2}`,
    m.spn !== undefined && `SPN "${m.spn}"`,
    m.imsiPrefix !== undefined && `IMSI ${m.imsiPrefix}…`,
    m.iccidPrefix !== undefined && `ICCID ${m.iccidPrefix}…`,
  ].filter((x) => x !== false);
  return { via: "MCC-MNC", key: m.mccmnc, match: also.length ? also.join(", ") : "any SIM" };
};

/** One badge per top-level key: the rarest thing under it. */
export function rareBadges(rows: readonly RareSetting[]): Record<string, KeyBadge[]> {
  const out: Record<string, KeyBadge[]> = {};
  for (const r of rows) {
    const top = r.path.split(/[.[]/, 1)[0] ?? r.path;
    if (out[top]) continue;
    const what = r.rare === "key" ? `${r.path} is set` : `${r.path} = ${r.value}`;
    const also = r.with.length ? ` (also ${r.with.join(", ")})` : " (no other source)";
    out[top] = [{ text: `${r.holders} of ${r.of}`, tone: "rare", title: `${what} in ${r.holders} of ${r.of} sources${also}` }];
  }
  return out;
}

/**
 * What people call a feature, and words its keys use: a filter for "VoNR" or "Wi-Fi Calling"
 * should find the settings even when no key spells it that way.
 */
const TERMS: Array<[RegExp, string[]]> = [
  [/^(vonr|voiceovernr|voice over 5g|vo5g)$/, ["vonr"]],
  [/^(sa|5gsa|standalone|5g standalone)$/, ["standalone"]],
  [/^(wifi ?calling|wi-fi calling|vowifi|wfc)$/, ["wificalling", "vowifi", "epdg", "iwlan"]],
  [/^(volte|voice over lte|4g calling|hd voice)$/, ["volte", "ims"]],
  [/^(hotspot|tethering|personal hotspot)$/, ["tethering", "wirelessmodem", "hotspot"]],
  [/^(5g|nr)$/, ["5g", "nr"]],
];

/** The filter text itself, plus the key words its feature uses; all lowercase, matched as substrings. */
export function searchTerms(filter: string): string[] {
  const q = filter.trim().toLowerCase();
  if (!q) return [];
  const extra = TERMS.find(([re]) => re.test(q))?.[1] ?? [];
  return [q, ...extra];
}
