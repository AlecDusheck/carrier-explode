/** The visitor's network as a carrier search: the longest run of the AS organisation's leading words that matches a carrier. */

import { fold } from "#lib/names.ts";

export interface Guessable {
	readonly name: string;
	readonly iso?: string | undefined;
}

const norm = (s: string): string =>
	s
		.toLowerCase()
		.replace(/&/g, "")
		.replace(/[^a-z0-9 ]+/g, "")
		.trim();

export function guessCarrierQuery(org: string | undefined, carriers: readonly Guessable[]): string | null {
	if (!org) return null;
	const words = norm(org).split(/\s+/).filter(Boolean);
	const haystack = carriers.map((c) => fold(c.name));
	for (let n = Math.min(words.length, 3); n >= 1; n--) {
		// "T-Mobile" normalises to one word, "AT T" to two that need joining; two letters match half the list by accident.
		const joined = words.slice(0, n).join("");
		if (joined.length >= 3 && haystack.some((h) => h.includes(joined))) return joined;
	}
	return null;
}

/** The carrier such a search most likely means: one from the visitor's country, then the plainest name. */
export function guessCarrierOf<C extends Guessable>(
	query: string,
	carriers: readonly C[],
	cc: string | null,
): C | null {
	const hits = carriers.filter((c) => fold(c.name).includes(query));
	hits.sort(
		(a, b) =>
			Number(b.iso === cc) - Number(a.iso === cc) ||
			a.name.length - b.name.length ||
			a.name.localeCompare(b.name),
	);
	return hits[0] ?? null;
}
