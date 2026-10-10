/**
 * The carrier a network is: an AS organisation's name, as Cloudflare reports it (`Telekom Deutschland GmbH`), matched
 * to the index's carriers by the words their names and ids share. Everything it knows comes from the carrier list.
 */

import { countryName } from "@carrier-explode/schema";

/** A carrier as the index lists it. */
export interface Carrier {
	/** Often keeps the operator's own name (`Chunghwa_tw` for 中華電信). */
	readonly id: string;
	readonly name: string;
	readonly iso: string | null;
}

/** Folded words: `AT&T Mobility, LLC` is `att mobility llc`. */
const wordsOf = (s: string): string[] =>
	s
		.normalize("NFD")
		.toLowerCase()
		.replace(/&/g, "")
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

/**
 * Words of the trade (`mobile`, `telecom`, `wireless`): in many carriers' names but seldom first, unlike a brand that
 * names many (`Orange B`, `Vodafone AU`).
 */
export function tradeWords(carriers: readonly Carrier[]): ReadonlySet<string> {
	const counts = new Map<string, { all: number; first: number }>();
	for (const name of new Set(carriers.map((c) => wordsOf(c.name).join(" "))))
		name.split(" ").forEach((w, i) => {
			const n = counts.get(w) ?? { all: 0, first: 0 };
			counts.set(w, { all: n.all + 1, first: n.first + Number(i === 0) });
		});
	return new Set([...counts].filter(([, n]) => n.all >= 8 && n.first * 4 < n.all).map(([w]) => w));
}

/** Each run of words, the longest first: `t mobile usa` has `t mobile usa`, `t mobile`, `mobile usa`, `t` … */
function spans(words: readonly string[]): string[][] {
	const out: string[][] = [];
	for (let n = words.length; n >= 1; n--)
		for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n));
	return out;
}

const runs = (words: readonly string[]): string[] => spans(words).map((s) => s.join(""));

/**
 * The carrier of `cc` whose name, else whose id, has the longest run of the organisation's words. A run of only `trade`
 * words (tradeWords of every carrier) and the country's (`China Mobile`) must be all of a name; failing a run, a name
 * its first word starts.
 */
export function networkCarrier<C extends Carrier>(
	org: string | null,
	carriers: readonly C[],
	cc: string | null,
	trade: ReadonlySet<string>,
): C | null {
	if (!org || cc === null) return null;
	const vague = new Set([cc, ...wordsOf(countryName(cc) ?? ""), ...trade]);
	const local = carriers
		.filter((c) => c.iso === cc)
		.toSorted((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
		.map((c) => ({
			c,
			whole: wordsOf(c.name).join(""),
			name: runs(wordsOf(c.name)),
			id: runs(wordsOf(c.id)),
		}));
	const words = wordsOf(org);
	for (const span of spans(words)) {
		const run = span.join("");
		const hit = span.every((w) => vague.has(w))
			? local.find((l) => l.whole === run)
			: run.length > 1 && (local.find((l) => l.name.includes(run)) ?? local.find((l) => l.id.includes(run)));
		if (hit) return hit.c;
	}
	const first = words.find((w) => !vague.has(w) && w.length >= 4);
	return first === undefined ? null : (local.find((l) => l.whole.startsWith(first))?.c ?? null);
}
