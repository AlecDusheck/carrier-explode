/** What version.xml has said of a model, and which sales codes a check asks it under. Pure: the check fetches, this decides. */

import * as v from "valibot";

const code = v.pipe(v.string(), v.regex(/^[A-Z0-9]{3}$/));

/** Under each sales code asked: the package of the newest build listed, or the day nothing was. */
const answersSchema = v.record(
	code,
	v.union([v.object({ package: code }), v.object({ refused: v.pipe(v.string(), v.isoDate()) })]),
);
type Answers = v.InferOutput<typeof answersSchema>;

export const modelProbesSchema = v.object({
	/** The oldest month (YYYY-MM) of any build listed; null while none dates. A model older than the scope is not asked again. */
	oldest: v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}$/))),
	answers: answersSchema,
});
export type ModelProbes = v.InferOutput<typeof modelProbesSchema>;

export const NO_PROBES: ModelProbes = { oldest: null, answers: {} };

/** Whether a model can be in scope: none of its builds seen yet predates `since` (YYYY-MM). */
export const mayLaunchSince = (probes: ModelProbes, since: string): boolean =>
	probes.oldest === null || probes.oldest >= since;

interface Lined {
	readonly line: { readonly family: string; readonly generation: number };
}

/**
 * A family's generations launch in order, so once one model of a generation is seen older than the scope, every model
 * of that generation or an earlier one is out without being asked. Newest generation first, so that is learnt early.
 */
export class LaunchBound {
	private readonly oldest = new Map<string, number>();

	constructor(private readonly since: string) {}

	/** Records a model's probes; false for a model out of scope. */
	seen({ line }: Lined, probes: ModelProbes): boolean {
		if (mayLaunchSince(probes, this.since)) return true;
		this.oldest.set(line.family, Math.max(this.oldest.get(line.family) ?? 0, line.generation));
		return false;
	}

	/** Whether a model of this line may still be in scope. */
	open({ line }: Lined): boolean {
		return line.generation > (this.oldest.get(line.family) ?? 0);
	}
}

export const newestGenerationFirst = (a: Lined, b: Lined): number => b.line.generation - a.line.generation;

/** A model reaches a region after it first ships, and FUS may serve a build it refused, so a refusal is asked again after this many days. */
const REASK_DAYS = 30;
const DAY_MS = 86_400_000;

/** Whether a refusal on day `refused` is old enough on `today` to ask again. */
export const reaskDue = (refused: string, today: string): boolean =>
	refused <= new Date(Date.parse(today) - REASK_DAYS * DAY_MS).toISOString().slice(0, 10);

/**
 * Of `codes`, in their order: the first that answered for each package, and each never asked or refused more than
 * REASK_DAYS before `today`. A package's other codes list its builds too, so they are not asked again.
 */
export function salesCodesToAsk(codes: readonly string[], answers: Answers, today: string): string[] {
	const packages = new Set<string>();
	return codes.filter((c) => {
		const a = answers[c];
		if (a === undefined) return true;
		if ("refused" in a) return reaskDue(a.refused, today);
		if (packages.has(a.package)) return false;
		packages.add(a.package);
		return true;
	});
}
