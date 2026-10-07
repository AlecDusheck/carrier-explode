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
import { chunks, run, type IndexDb } from "./db.ts";
import { carriers, devices, labels, modems, sources } from "./schema.ts";

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

/** The name a person gave carrier `id` through one of its member sources: it holds whatever id linking assigns. */
export const sourceCarrierName = (id: SQLWrapper): SQL<string | null> => sql<
	string | null
>`(SELECT ${labels.value} FROM ${labels}
  JOIN ${sources} ON ${sources.key} = ${labels.code} WHERE ${labels.subject} = 'source' AND ${labels.field} = 'carrierName' AND ${sources.carrier} = ${id}
  ORDER BY ${sources.key} LIMIT 1)`;

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

/** Codes the index uses that nothing names: devices, carriers whose members display no name, modem families. */
export async function unnamed(db: IndexDb, subject: Exclude<LabelSubject, "source">): Promise<string[]> {
	const nameless = (code: SQLWrapper): SQL => sql`${labelled(subject, "name", code)} IS NULL`;
	const rows = await {
		device: () => db.select({ code: devices.code }).from(devices).where(nameless(devices.code)),
		// One named for a SIM selector (20404GID1=2801) has nothing a search can find.
		carrier: () =>
			db
				.select({ code: carriers.id })
				.from(carriers)
				.where(
					and(
						sql`${carriers.name} IS NULL`,
						sql`${carriers.id} NOT LIKE '%=%'`,
						nameless(carriers.id),
						sql`${sourceCarrierName(carriers.id)} IS NULL`,
					),
				),
		modem: () => db.selectDistinct({ code: modems.family }).from(modems).where(nameless(modems.family)),
	}[subject]();
	return rows.map((r) => r.code).toSorted();
}
