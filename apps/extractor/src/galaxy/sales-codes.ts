/** Which sales codes a check asks version.xml under for a model. Pure: the check fetches, this decides. */

import * as v from "valibot";

const code = v.pipe(v.string(), v.regex(/^[A-Z0-9]{3}$/));

/** What version.xml said of a model under each sales code: the package of the newest build it listed, or the day it listed none. */
export const salesCodeAnswersSchema = v.record(
	code,
	v.union([v.object({ package: code }), v.object({ refused: v.pipe(v.string(), v.isoDate()) })]),
);
export type SalesCodeAnswers = v.InferOutput<typeof salesCodeAnswersSchema>;

/** A model reaches a region after it first ships, so a refusal is asked again after this many days. */
const REASK_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Of `codes`, in their order: the first that answered for each package, and each never asked or refused more than
 * REASK_DAYS before `today`. A package's other codes list its builds too, so they are not asked again.
 */
export function salesCodesToAsk(
	codes: readonly string[],
	answers: SalesCodeAnswers,
	today: string,
): string[] {
	const reaskFrom = new Date(Date.parse(today) - REASK_DAYS * DAY_MS).toISOString().slice(0, 10);
	const packages = new Set<string>();
	return codes.filter((c) => {
		const a = answers[c];
		if (a === undefined) return true;
		if ("refused" in a) return a.refused <= reaskFrom;
		if (packages.has(a.package)) return false;
		packages.add(a.package);
		return true;
	});
}
