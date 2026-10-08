/** Labels: written by feeds, people and the labels Workflow, and joined into every query that shows a name. */

import { and, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import * as v from "valibot";

import {
	LABEL_FIELDS,
	labelField,
	labelSchema,
	trustRank,
	type Label,
	type LabelFieldName,
	type LabelSubject,
} from "@carrier-explode/schema/records";
import type { Platform } from "@carrier-explode/schema/types";
import { chunks, qualified, run, type IndexDb } from "./db.ts";
import {
	carriers,
	devices,
	labelMisses,
	labels,
	modemConfigs,
	modems,
	releases,
	sims,
	sources,
} from "./schema.ts";

const inList = (values: readonly string[]): SQL => sql.raw(values.map((x) => `'${x}'`).join(", "));

/**
 * The value pages show for `code`'s field: a label from an origin the field trusts above the data (which ranks just
 * above `feed`), else `derived`, else any label.
 */
export function labelled<S extends LabelSubject>(
	subject: S,
	field: LabelFieldName<S>,
	code: SQLWrapper,
	derived?: SQLWrapper,
): SQL<string | null> {
	const fields: Readonly<Record<string, Parameters<typeof trustRank>[0]>> = LABEL_FIELDS[subject];
	const of = fields[field];
	if (of === undefined) throw new Error(`${subject} has no label field ${field}`);
	const label = (origins: SQL | undefined): SQL => sql`(SELECT ${labels.value} FROM ${labels}
    WHERE ${labels.subject} = ${subject} AND ${labels.code} = ${code} AND ${labels.field} = ${field}${origins === undefined ? sql`` : sql` AND ${labels.origin} IN (${origins})`})`;
	if (derived === undefined) return sql<string | null>`${label(undefined)}`;
	const outranking = of.trust.filter((o) => trustRank(of, o) < trustRank(of, "feed"));
	return sql<string | null>`coalesce(${label(inList(outranking))}, ${derived}, ${label(undefined)})`;
}

/** Labels, each replacing what its subject's field holds unless that came from an origin the field trusts more. */
export async function writeLabels(db: IndexDb, rows: readonly Label[]): Promise<void> {
	const checked = v.parse(v.array(labelSchema), rows);
	const byField = Map.groupBy(checked, (l) => `${l.subject}\u0000${l.field}`);
	await run(
		db,
		[...byField.values()].flatMap((group) => {
			const [head] = group;
			if (head === undefined) return [];
			const { trust } = labelField(head);
			const rank = (origin: SQL): SQL =>
				sql`CASE ${origin} ${sql.raw(trust.map((o, i) => `WHEN '${o}' THEN ${i}`).join(" "))} ELSE ${trust.length} END`;
			return chunks(group, 6).map((some) =>
				db
					.insert(labels)
					.values(some)
					.onConflictDoUpdate({
						target: [labels.subject, labels.code, labels.field],
						set: {
							value: sql`excluded.value`,
							origin: sql`excluded.origin`,
							evidence: sql`excluded.evidence`,
						},
						setWhere: sql`${rank(sql`excluded.origin`)} <= ${rank(sql`${labels.origin}`)}`,
					}),
			);
		}),
	);
}

/** A feed's values for one field, written where they differ from what is stored. */
export async function syncLabels<S extends LabelSubject>(
	db: IndexDb,
	subject: S,
	field: LabelFieldName<S>,
	listed: ReadonlyArray<Pick<Label, "code" | "value">>,
	evidence: string,
): Promise<number> {
	const held = new Map(
		(
			await db
				.select({ code: labels.code, value: labels.value, origin: labels.origin })
				.from(labels)
				.where(and(eq(labels.subject, subject), eq(labels.field, field)))
		).map((r) => [r.code, r]),
	);
	const changed = listed.filter((n) => {
		const h = held.get(n.code);
		return h === undefined || h.origin !== "feed" || h.value !== n.value;
	});
	await writeLabels(
		db,
		changed.map((n) =>
			v.parse(labelSchema, { subject, field, code: n.code, value: n.value, origin: "feed", evidence }),
		),
	);
	return changed.length;
}

/**
 * Where codes nothing names come from: `device`, a phone an indexed release lists; `modemConfig`, a modem configuration
 * whose selection names no PLMN, so no carrier's name stands for it (MediaTek's `SBP 141`).
 */
export const LABEL_CANDIDATE_KINDS = ["device", "carrier", "modemFamily", "modemConfig"] as const;
export type LabelCandidateKind = (typeof LABEL_CANDIDATE_KINDS)[number];

/** The subject each kind's codes are labelled under. */
export const CANDIDATE_SUBJECT = {
	device: "device",
	carrier: "carrier",
	modemFamily: "modem",
	modemConfig: "modem",
} as const satisfies Record<LabelCandidateKind, LabelSubject>;

/** A code nothing names, with the platform it ships on (a carrier's first member's) and a carrier's country. */
export interface LabelCandidate {
	readonly kind: LabelCandidateKind;
	readonly code: string;
	readonly platform: Platform;
	readonly iso: string | null;
}

/** A code no search named is searched again a quarter later, when new pages may name it. */
const SEARCH_AGAIN_AFTER_DAYS = 91;

/** Up to `take` codes of a kind that nothing names, those never searched first, then those longest since a search missed. */
export async function labelCandidates(
	db: IndexDb,
	kind: LabelCandidateKind,
	take: number,
	today: string,
): Promise<LabelCandidate[]> {
	const subject = CANDIDATE_SUBJECT[kind];
	const code = {
		device: qualified(devices, devices.code),
		carrier: qualified(carriers, carriers.id),
		modemFamily: qualified(modems, modems.family),
		modemConfig: qualified(modemConfigs, modemConfigs.label),
	}[kind];
	const missed = sql`(SELECT ${labelMisses.searched} FROM ${labelMisses}
    WHERE ${labelMisses.subject} = ${subject} AND ${labelMisses.code} = ${code} AND ${labelMisses.field} = 'name')`;
	const due = sql`coalesce(${missed} <= date(${today}, ${`-${SEARCH_AGAIN_AFTER_DAYS} days`}), 1)`;
	const wanted = sql`${labelled(subject, "name", code)} IS NULL AND ${due}`;
	const order = [sql`${missed} IS NOT NULL`, missed, code] as const;
	const none = sql<string | null>`NULL`;
	const of = sql<LabelCandidateKind>`${kind}`;
	return {
		device: () =>
			db
				.select({ kind: of, code: devices.code, platform: devices.platform, iso: none })
				.from(devices)
				.where(
					and(
						wanted,
						sql`EXISTS (SELECT 1 FROM ${releases} r, json_each(r.devices) j WHERE j.value = ${code})`,
					),
				)
				.orderBy(...order)
				.limit(take),
		carrier: () =>
			db
				.select({
					kind: of,
					code: carriers.id,
					platform: sql<Platform>`min(${sources.platform})`,
					iso: carriers.iso,
				})
				.from(carriers)
				.innerJoin(sources, eq(sources.carrier, carriers.id))
				.where(and(sql`${carriers.name} IS NULL`, wanted))
				.groupBy(carriers.id)
				.orderBy(...order)
				.limit(take),
		modemFamily: () =>
			db
				.selectDistinct({ kind: of, code: modems.family, platform: modems.platform, iso: none })
				.from(modems)
				.where(wanted)
				.orderBy(...order)
				.limit(take),
		modemConfig: () =>
			db
				.select({
					kind: of,
					code: modemConfigs.label,
					platform: sql<Platform>`min(${modemConfigs.platform})`,
					iso: none,
				})
				.from(modemConfigs)
				.where(
					and(
						wanted,
						sql`${code} NOT IN (SELECT c.label FROM ${modemConfigs} c JOIN ${sims} ON ${sims.sha} = c.sha)`,
					),
				)
				.groupBy(modemConfigs.label)
				.orderBy(...order)
				.limit(take),
	}[kind]();
}

/** That a search on `today` found no page giving `code`'s name. */
export async function writeLabelMiss(
	db: IndexDb,
	subject: LabelSubject,
	code: string,
	today: string,
): Promise<void> {
	await db
		.insert(labelMisses)
		.values({ subject, code, field: "name", searched: today })
		.onConflictDoUpdate({
			target: [labelMisses.subject, labelMisses.code, labelMisses.field],
			set: { searched: today },
		});
}
