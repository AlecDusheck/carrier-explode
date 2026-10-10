/** What the matrix shows for a URL's search; the page and its Markdown both read it from here. */

import type { Requirement, Rule, RuleId } from "#lib/feature-matrix.ts";
import { fold } from "#lib/names.ts";
import type { Scored } from "./score.ts";

export const MISSES = [
	["0", "No misses"],
	["1", "1 miss"],
	["2", "2 misses"],
	["all", "Any misses"],
] as const;
export type Miss = (typeof MISSES)[number][0];

export const readMiss = (params: Pick<URLSearchParams, "get">): Miss =>
	MISSES.find(([m]) => m === params.get("miss"))?.[0] ?? "0";

/** The rules picked, as indexes into `rules`. */
export const pickedRules = (rules: readonly Rule[], reqs: ReadonlyMap<RuleId, Requirement>): number[] =>
	rules.flatMap((r, i) => ((reqs.get(r.id)?.mode ?? "off") === "off" ? [] : [i]));

/** Once something is picked, only it is shown unless asked: a sea of tiles hides what was asked for. */
export const showsEverything = (params: Pick<URLSearchParams, "has">, picked: readonly number[]): boolean =>
	params.has("all") || picked.length === 0;

/** Picked columns lead, so on a phone they are in view without panning. */
export const shownColumns = (
	rules: readonly Rule[],
	picked: readonly number[],
	everything: boolean,
): number[] =>
	everything ? [...picked, ...rules.flatMap((_, i) => (picked.includes(i) ? [] : [i]))] : [...picked];

export const searched = (scored: readonly Scored[], find: string): readonly Scored[] => {
	const f = fold(find);
	return f ? scored.filter((s) => s.text.includes(f)) : scored;
};

export const meetsAll = (s: Scored): boolean => s.need === 0 && s.want === 0;

/** The carriers found, and of them those meeting every requirement once any is picked. */
export const tally = (found: readonly Scored[], picked: number, find: string, phone: string): string =>
	`${picked ? `${found.filter(meetsAll).length} of ${found.length}` : found.length} carriers${find ? ` for “${find}”` : ""}${picked ? " meet every requirement" : ""} on the ${phone}`;

export const NO_PHONE = "No phone has feature states yet.";

export const noneShown = (find: string): string =>
	`No carrier${find ? " found" : ""} has every required feature. Allow a miss, require less${find ? ", or clear the search" : ""}.`;

export const withinMisses = (found: readonly Scored[], miss: Miss): Scored[] => {
	const limit = miss === "all" ? Infinity : Number(miss);
	return found.filter((s) => s.need <= limit);
};

/** The columns a row's count is of: the picked ones, or all shown when none are picked. */
export const countedColumns = (columns: readonly number[], picked: number): readonly number[] =>
	picked ? columns.slice(0, picked) : columns;

export const metCount = (s: Scored, counted: readonly number[]): number =>
	counted.filter((c) => s.outcomes[c] === true).length;
