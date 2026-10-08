/** What every platform's settings views share: how a SIM selects a source, rarity badges, and the words a filter matches. */

import type { RareRow } from "#lib/server/scan.ts";
import { isTestPlmn } from "@carrier-explode/schema";
import { parseRuleKey, type SimMatcher, type SimRule } from "@carrier-explode/schema/types";
import { isRecord } from "@carrier-explode/values";
import type { KeyBadge } from "#lib/components/Tree.svelte";

/** How a SIM gets this bundle: by its MCC-MNC and what else it must carry, an ICCID prefix, or a CDMA carrier ID. */
export interface SelectionRule {
	readonly via: string;
	readonly key: string;
	/** Which SIMs on that key it takes. */
	readonly match: string;
}

type Qualifier = Exclude<keyof SimMatcher, "mccmnc">;

/** What each qualifier a SIM must carry reads as, in the order the tables list them. */
const QUALIFIERS = {
	gid1: (v) => `GID1 ${v}`,
	gid2: (v) => `GID2 ${v}`,
	spn: (v) => `SPN "${v}"`,
	imsiPrefix: (v) => `IMSI ${v}…`,
	iccidPrefix: (v) => `ICCID ${v}…`,
} as const satisfies Record<Qualifier, (value: string) => string>;

const isQualifier = (q: string): q is Qualifier => Object.hasOwn(QUALIFIERS, q);

/** What a rule on an MCC-MNC alone matches. */
const ANY_SIM = "any SIM";

/** A SIM rule as the selection tables show it: the PLMN it keys on, and what else a SIM must carry. */
export const simRule = (m: SimMatcher): SelectionRule => {
	const also = Object.entries(QUALIFIERS).flatMap(([q, text]) => {
		const value = isQualifier(q) ? m[q] : undefined;
		return value === undefined ? [] : [text(value)];
	});
	return { via: "MCC-MNC", key: m.mccmnc, match: also.length ? also.join(", ") : ANY_SIM };
};

/** The order the tables list each kind of routing rule in. */
const RULE_ORDER = ["plmn", "iccid", "carrierId"] as const satisfies ReadonlyArray<SimRule["by"]>;

function ruleRow(r: SimRule): SelectionRule {
	switch (r.by) {
		case "plmn":
			return simRule(r.sim);
		case "iccid":
			return { via: "ICCID", key: `${r.prefix}…`, match: "by SIM card number" };
		case "carrierId":
			return { via: "Carrier ID", key: r.id, match: "CDMA carrier ID" };
	}
}

/** Routing rules as the selection tables show them: PLMN rules, then ICCID prefixes, then carrier IDs. */
export const ruleRows = (rules: readonly SimRule[]): SelectionRule[] =>
	rules.toSorted((a, b) => RULE_ORDER.indexOf(a.by) - RULE_ORDER.indexOf(b.by)).map(ruleRow);

/** SIM rules as the index stores them (schema's ruleKeys), as the selection tables show them. */
export function keyRules(keys: readonly string[]): SelectionRule[] {
	return ruleRows(
		keys.map((key) => {
			const rule = parseRuleKey(key);
			if (rule === undefined) throw new Error(`${key} is no SIM rule`);
			return rule;
		}),
	);
}

const isTestRule = (r: SelectionRule): boolean => r.via === "MCC-MNC" && isTestPlmn(r.key);

/** A selection table's row: which SIMs, on every key that takes them. */
export type SelectionRow = Pick<SelectionRule, "via" | "match"> & { readonly keys: readonly string[] };

/**
 * Rules as a selection table lists them: one row per kind of SIM, its keys beside it, test networks in one row. A
 * narrower rule on a key any SIM already selects by is left out: it selects nothing more.
 */
export function selectionRows(rules: readonly SelectionRule[]): SelectionRow[] {
	const vias = [...new Set(rules.map((r) => r.via))];
	const open = new Set(rules.filter((r) => r.match === ANY_SIM).map((r) => `${r.via}\n${r.key}`));
	const real = rules.filter(
		(r) => !isTestRule(r) && (r.match === ANY_SIM || !open.has(`${r.via}\n${r.key}`)),
	);
	const grouped = Map.groupBy(real, (r) => `${r.via}\n${r.match}`);
	const rows = [...grouped.values()].flatMap(([first, ...rest]): SelectionRow[] =>
		first === undefined
			? []
			: [
					{
						via: first.via,
						match: first.match,
						keys: [...new Set([first, ...rest].map((r) => r.key))].toSorted(),
					},
				],
	);
	const sorted = rows.toSorted(
		(a, b) =>
			vias.indexOf(a.via) - vias.indexOf(b.via) ||
			Number(b.match === ANY_SIM) - Number(a.match === ANY_SIM) ||
			a.match.localeCompare(b.match, "en"),
	);
	const tests = [...new Set(rules.filter(isTestRule).map((r) => r.key))].toSorted();
	return tests.length ? [...sorted, { via: "MCC-MNC", match: "test networks", keys: tests }] : sorted;
}

/** How many settings a value tree holds, as its tabs count them: each leaf, a list of plain values counting as one. */
export function leafCount(value: unknown): number {
	if (Array.isArray(value)) {
		const items: readonly unknown[] = value;
		return items.some((x) => typeof x === "object" && x !== null)
			? items.reduce((n: number, x) => n + leafCount(x), 0)
			: 1;
	}
	if (isRecord(value)) return Object.values(value).reduce((n: number, x) => n + leafCount(x), 0);
	return 1;
}

/** One badge per top-level key: the rarest thing under it. */
export function rareBadges(rows: readonly RareRow[]): Record<string, KeyBadge[]> {
	const out: Record<string, KeyBadge[]> = {};
	for (const r of rows) {
		const top = r.path.split(/[.[]/, 1)[0] ?? r.path;
		if (out[top]) continue;
		const what = r.rare === "key" ? `${r.path} is set` : `${r.path} = ${r.value}`;
		const also = r.with.length ? ` (also ${r.with.map((w) => w.key).join(", ")})` : " (no other source)";
		out[top] = [{ text: "rare", tone: "rare", title: `${what} in ${r.holders} of ${r.of} sources${also}` }];
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
