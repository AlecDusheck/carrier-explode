/** Carrier ids: the primary member's name (`ATT_US`), or `<platform>-<name>` when taken; kept across links while still one of the carrier's names. */

import { sourceKey, type SourceRef } from "./types.ts";

const namesOf = (s: SourceRef): readonly [string, string] => [s.name, `${s.platform}-${s.name}`];

/**
 * Each carrier with its id, in input order; `membersOf` lists a carrier's members primary first.
 * Larger carriers choose first, so a split's larger part keeps the old id.
 */
export function assignIds<C>(
	carriers: readonly C[],
	membersOf: (c: C) => readonly SourceRef[],
	previous: Readonly<Record<string, string>>,
): Array<{ readonly carrier: C; readonly id: string }> {
	const taken = new Set<string>();
	const order = carriers
		.map((carrier, i) => ({ carrier, members: membersOf(carrier), i }))
		.toSorted((a, b) => b.members.length - a.members.length || a.i - b.i);
	const chosen = order.map(({ carrier, members, i }) => {
		const own = new Set(members.flatMap(namesOf));
		const votes = new Map<string, number>();
		for (const m of members) {
			const id = previous[sourceKey(m)];
			if (id !== undefined && own.has(id)) votes.set(id, (votes.get(id) ?? 0) + 1);
		}
		// On a tie, the id nearest the primary member: a pack linked to a bundle takes the bundle's carrier's id.
		const rank = (id: string): number => members.findIndex((m) => namesOf(m).includes(id));
		const kept = [...votes]
			.toSorted((x, y) => y[1] - x[1] || rank(x[0]) - rank(y[0]) || x[0].localeCompare(y[0]))
			.map(([id]) => id);
		const head = members[0];
		const id = [...kept, ...(head === undefined ? [] : namesOf(head))].find((c) => !taken.has(c));
		if (id === undefined) throw new Error(`carrier ids: no free id for ${members.map(sourceKey).join(", ")}`);
		taken.add(id);
		return { carrier, id, i };
	});
	return chosen.toSorted((a, b) => a.i - b.i).map(({ carrier, id }) => ({ carrier, id }));
}
