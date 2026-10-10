/** Feature trees: a carrier's rules or concepts, each under the one it refines, in groups. */

import { conceptById } from "@carrier-explode/schema";
import {
	isTreeConcept,
	PLACES,
	RULE_GROUPS,
	type MatrixCell,
	type Requirement,
	type Rule,
	type RuleGroup,
	type RuleId,
	type TreeConcept,
} from "#lib/feature-matrix.ts";
import type { FeatureIcon } from "#lib/feature-icons.ts";
import { cellWords, toneOf, type Scored, type Tone } from "./score.ts";

export interface FeatureNode {
	readonly id: string;
	readonly icon: FeatureIcon;
	readonly tone: Tone;
	readonly name: string;
	/** What the carrier gives: a state, or a setting's value. */
	readonly words: string;
	readonly href: string | null;
	/** Shown at full strength: in the matrix, a picked requirement. */
	readonly strong: boolean;
	readonly children: readonly FeatureNode[];
}

export interface FeatureGroup {
	readonly group: RuleGroup;
	readonly roots: readonly FeatureNode[];
}

interface Item {
	readonly node: Omit<FeatureNode, "children">;
	readonly under: string | null;
	readonly group: RuleGroup;
}

/** Each item under its parent when the parent is present; a root's group is its tree's. */
function forest(items: readonly Item[]): FeatureGroup[] {
	const ids = new Set(items.map((i) => i.node.id));
	const parentOf = (i: Item): string | null => (i.under !== null && ids.has(i.under) ? i.under : null);
	const grow = (parent: string | null): FeatureNode[] =>
		items
			.filter((i) => parentOf(i) === parent)
			.map((i) => Object.assign({ children: grow(i.node.id) }, i.node));
	const roots = grow(null);
	const groupOf = new Map(items.map((i) => [i.node.id, i.group]));
	return RULE_GROUPS.flatMap((group) => {
		const mine = roots.filter((r) => groupOf.get(r.id) === group);
		return mine.length ? [{ group, roots: mine }] : [];
	});
}

/** One carrier's rules, judged against the visitor's requirements. */
export const ruleTree = (
	scored: Scored,
	rules: readonly Rule[],
	reqs: ReadonlyMap<RuleId, Requirement>,
): FeatureGroup[] =>
	forest(
		rules.map((rule, i) => {
			const mode = reqs.get(rule.id)?.mode ?? "off";
			const cell = scored.cells[i] ?? "unknown";
			return {
				node: {
					id: rule.id,
					icon: rule.icon,
					tone: toneOf(scored.outcomes[i] ?? null, mode, cell),
					name: rule.name,
					words: cellWords(cell),
					href: null,
					strong: mode !== "off",
				},
				under: rule.under,
				group: rule.group,
			};
		}),
	);

/** What a carrier gives with nothing required: on or set, offered but off, or neither. */
export function cellTone(cell: MatrixCell): Tone {
	if (cell === "unknown") return "blank";
	if (cell === "on") return "met";
	if (cell === "available") return "offered";
	if (cell === "no" || cell === "unset") return "unmet";
	const v = cell.value;
	return v === false || (Array.isArray(v) && v.length === 0) ? "unmet" : "met";
}

const TREE_ORDER = Object.keys(PLACES).filter(isTreeConcept);

/** What a node of a concept shows, however its tone and words are judged. */
export type ConceptFace = Pick<FeatureNode, "tone" | "words" | "href">;

/** Concepts in their tree; `face` judges each, and a concept it leaves undefined is not drawn. */
export const conceptTree = (face: (id: TreeConcept) => ConceptFace | undefined): FeatureGroup[] =>
	forest(
		TREE_ORDER.flatMap((id) => {
			const f = face(id);
			if (f === undefined) return [];
			const place = PLACES[id];
			return [
				{
					node: { id, icon: place.icon, name: conceptById(id)?.name ?? id, strong: true, ...f },
					under: place.under,
					group: place.group,
				},
			];
		}),
	);
