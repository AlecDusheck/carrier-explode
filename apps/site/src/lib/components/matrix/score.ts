/** Each carrier judged against the visitor's requirements: fewest required misses first, then nice-to-haves, then by name. */

import { STATUS } from "#lib/feature-pages.ts";
import type {
	MatrixCell,
	MatrixConcept,
	Mode,
	Outcome,
	Requirement,
	Rule,
	RuleId,
} from "#lib/feature-matrix.ts";
import { fold } from "#lib/names.ts";
import type { MatrixRow } from "#lib/server/features.ts";

export interface Scored {
	readonly row: MatrixRow;
	/** By rule, in the rules' order. */
	readonly outcomes: readonly Outcome[];
	/** By rule: the cell of the first concept it reads, which the tooltip shows. */
	readonly cells: readonly MatrixCell[];
	/** Required rules it misses, then nice-to-haves. */
	readonly need: number;
	readonly want: number;
	readonly text: string;
}

const reader =
	(index: ReadonlyMap<MatrixConcept, number>, row: MatrixRow) =>
	(id: MatrixConcept): MatrixCell =>
		row.cells[index.get(id) ?? -1] ?? "unknown";

export function score(
	rows: readonly MatrixRow[],
	columns: readonly MatrixConcept[],
	rules: readonly Rule[],
	reqs: ReadonlyMap<RuleId, Requirement>,
	country: (cc: string) => string,
): Scored[] {
	const index = new Map(columns.map((id, i) => [id, i]));
	const modes = rules.map((r) => reqs.get(r.id) ?? { mode: "off", param: "" });
	return rows
		.map((row) => {
			const read = reader(index, row);
			let need = 0;
			let want = 0;
			const outcomes = rules.map((rule, i) => {
				const req = modes[i];
				const o = rule.test(read, req?.param ?? "");
				if (o === false && req?.mode === "need") need++;
				if (o === false && req?.mode === "want") want++;
				return o;
			});
			const e = row.entry;
			const cells = rules.map((rule) => read(rule.reads[0]));
			return {
				row,
				outcomes,
				cells,
				need,
				want,
				text: fold(`${e.brand} ${e.name} ${e.cc === undefined ? "" : country(e.cc)}`),
			};
		})
		.toSorted(
			(a, b) =>
				a.need - b.need || a.want - b.want || a.row.entry.brand.localeCompare(b.row.entry.brand, "en"),
		);
}

const TONES = ["met", "offered", "unmet", "need", "want", "blank"] as const;
export type Tone = (typeof TONES)[number];

/** Green only for a feature offered but off until turned on; the rest by outcome and how much it matters. */
export function toneOf(outcome: Outcome, mode: Mode, first: MatrixCell): Tone {
	if (outcome === null) return "blank";
	if (outcome) return first === "available" ? "offered" : "met";
	return mode === "need" ? "need" : mode === "want" ? "want" : "unmet";
}

/** The tone of a row's tile for `rules[i]`. */
export const tileTone = (s: Scored, i: number, mode: Mode): Tone =>
	toneOf(s.outcomes[i] ?? null, mode, s.cells[i] ?? "unknown");

/** A tone as the legend says it. */
export const TONE_WORDS = {
	met: "On",
	offered: "Off until turned on",
	unmet: "Not given",
	need: "Not given",
	want: "Not given",
	blank: "No data",
} as const satisfies Record<Tone, string>;

/** What a cell holds, as the tooltip says it. */
export function cellWords(cell: MatrixCell): string {
	if (typeof cell === "string") return STATUS[cell].label;
	const v = cell.value;
	return Array.isArray(v) ? v.join(", ") || "None" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
}
