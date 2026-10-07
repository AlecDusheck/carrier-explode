/** What a release changed: its sources against its platform's previous release, every device counted. */

import { newestOf, type DeviceOrder } from "./devices.ts";
import type { EntryRef, SourceKey } from "./types.ts";

/** One copy a release ships, with the entry it is on its line. */
export interface ShippedCopy extends EntryRef {
	readonly source: SourceKey;
	readonly sha: string;
}

/** How a release changed a source against its platform's previous release. */
export type ReleaseChange = { readonly source: SourceKey } & (
	| { readonly kind: "added"; readonly to: EntryRef }
	| { readonly kind: "removed"; readonly from: EntryRef }
	| { readonly kind: "changed"; readonly from: EntryRef; readonly to: EntryRef }
);

/** A source in one release: every file it ships, so a change on any device counts, and the entry a change links to. */
interface Carried {
	readonly content: string;
	readonly at: EntryRef;
}

/** The entry on the newest device's line (Apple ships on its main line alone). */
function carried(copies: readonly ShippedCopy[], order: DeviceOrder): Map<SourceKey, Carried> {
	return new Map(
		[...Map.groupBy(copies, (c) => c.source)].flatMap(([source, shipped]) => {
			const line = newestOf(
				order,
				shipped.map((c) => c.line),
			);
			const at = shipped.find((c) => c.line === line);
			if (at === undefined) return [];
			const content = [...new Set(shipped.map((c) => c.sha))].toSorted().join(",");
			return [[source, { content, at: { line: at.line, slug: at.slug } }] as const];
		}),
	);
}

/** `now`'s changes against `previous`, the release before it on its platform; a platform's first release has none. */
export function releaseChanges(
	previous: readonly ShippedCopy[] | null,
	now: readonly ShippedCopy[],
	order: DeviceOrder,
): ReleaseChange[] {
	if (previous === null) return [];
	const was = carried(previous, order),
		is = carried(now, order);
	return [...new Set([...was.keys(), ...is.keys()])].toSorted().flatMap((source): ReleaseChange[] => {
		const a = was.get(source),
			b = is.get(source);
		if (a === undefined) return b === undefined ? [] : [{ source, kind: "added", to: b.at }];
		if (b === undefined) return [{ source, kind: "removed", from: a.at }];
		return a.content === b.content ? [] : [{ source, kind: "changed", from: a.at, to: b.at }];
	});
}
