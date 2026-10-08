/** Two Profiles side by side: concepts by reading, APNs by name and types, raw leaves only within one decoder family. */

import { canonical } from "@carrier-explode/values";
import { CONCEPT_GROUPS, conceptById, conceptOrder, type ConceptGroup } from "./concepts.ts";
import {
	decoderFamily,
	sourceKey,
	type Apn,
	type ConceptValue,
	type DecoderFamily,
	type Json,
	type Profile,
} from "./types.ts";
import { readingKey } from "./values.ts";

/** How the two sides stand on one concept both set or one leaves unset; `only-a`/`only-b`: only that side can express it at all. */
export type ConceptRow =
	| {
			readonly id: string;
			readonly status: "same" | "different";
			readonly a: ConceptValue;
			readonly b: ConceptValue;
	  }
	| { readonly id: string; readonly status: "only-a"; readonly a: ConceptValue }
	| { readonly id: string; readonly status: "only-b"; readonly b: ConceptValue };

interface ConceptGroupRows {
	readonly group: ConceptGroup;
	readonly rows: readonly ConceptRow[];
}

type ApnField = Exclude<keyof Apn, "path" | "apn">;

export type ApnRow =
	| {
			readonly apn: string;
			readonly status: "matched";
			readonly a: Apn;
			readonly b: Apn;
			readonly sameTypes: boolean;
			readonly differs: readonly ApnField[];
	  }
	| { readonly apn: string; readonly status: "only-a"; readonly a: Apn }
	| { readonly apn: string; readonly status: "only-b"; readonly b: Apn };

type RawRow =
	| { readonly path: string; readonly status: "changed"; readonly a: Json; readonly b: Json }
	| { readonly path: string; readonly status: "only-a"; readonly a: Json }
	| { readonly path: string; readonly status: "only-b"; readonly b: Json };

export type ProfileComparison = {
	readonly a: string;
	readonly b: string;
	readonly groups: readonly ConceptGroupRows[];
	readonly apns: readonly ApnRow[];
} & ({ readonly sameFamily: true; readonly raw: readonly RawRow[] } | { readonly sameFamily: false });

function conceptRow(
	id: string,
	a: ConceptValue | undefined,
	b: ConceptValue | undefined,
): ConceptRow | undefined {
	// Neither setting it is no reading to compare.
	if (a?.kind === "unset" && b?.kind === "unset") return undefined;
	if (a && b) return { id, status: readingKey(a) === readingKey(b) ? "same" : "different", a, b };
	if (a) return { id, status: "only-a", a };
	return b ? { id, status: "only-b", b } : undefined;
}

function conceptGroups(a: Profile, b: Profile): ConceptGroupRows[] {
	const ids = [...new Set([...Object.keys(a.concepts), ...Object.keys(b.concepts)])].toSorted(
		(x, y) => conceptOrder(x) - conceptOrder(y) || x.localeCompare(y),
	);
	const byGroup = new Map<ConceptGroup, ConceptRow[]>();
	for (const id of ids) {
		const row = conceptRow(id, a.concepts[id], b.concepts[id]);
		const group = conceptById(id)?.group;
		if (!row || !group) continue;
		byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
	}
	return CONCEPT_GROUPS.flatMap((group) => {
		const rows = byGroup.get(group);
		return rows ? [{ group, rows }] : [];
	});
}

/** Each field once: the compiler checks the list is complete. */
const APN_FIELDS: readonly ApnField[] = Object.values({
	label: "label",
	types: "types",
	protocol: "protocol",
	roamingProtocol: "roamingProtocol",
	auth: "auth",
	user: "user",
	password: "password",
	proxy: "proxy",
	port: "port",
	mmsc: "mmsc",
	mmsProxy: "mmsProxy",
	mmsPort: "mmsPort",
	mtu: "mtu",
	bearers: "bearers",
} as const satisfies { readonly [F in ApnField]: F });

/** The fields each family's APN reader can write: Apple's has no label, proxy, port or MTU; Galaxy's no bearers. */
const STATED: Readonly<Record<DecoderFamily, ReadonlySet<ApnField>>> = {
	apple: new Set<ApnField>([
		"types",
		"protocol",
		"roamingProtocol",
		"auth",
		"user",
		"password",
		"mmsc",
		"mmsProxy",
		"mmsPort",
		"bearers",
	]),
	android: new Set(APN_FIELDS),
	samsung: new Set(APN_FIELDS.filter((f) => f !== "bearers")),
};

/** Types and bearers are sets. */
const fieldText = (v: Apn[ApnField]): string =>
	v === undefined ? "" : canonical(typeof v === "object" ? [...v].toSorted() : v);

/** Across families, a field one family cannot state (and a label, a name for people) is not a difference; one only one side sets is. */
function differs(x: Apn, y: Apn, families: readonly [DecoderFamily, DecoderFamily]): ApnField[] {
	const [fx, fy] = families;
	return APN_FIELDS.filter((f) => {
		if (fx !== fy && (f === "label" || !STATED[fx].has(f) || !STATED[fy].has(f))) return false;
		return fieldText(x[f]) !== fieldText(y[f]);
	});
}

const typesKey = (a: Apn): string => [...a.types].toSorted().join(",");
const nameOf = (a: Apn): string => a.apn.toLowerCase();

function apnRows(
	a: readonly Apn[],
	b: readonly Apn[],
	families: readonly [DecoderFamily, DecoderFamily],
): ApnRow[] {
	const right = [...b];
	const rows: ApnRow[] = [];
	const unmatched: Apn[] = [];
	const take = (x: Apn, match: (y: Apn) => boolean): boolean => {
		const j = right.findIndex(match);
		const y = right[j];
		if (y === undefined) return false;
		right.splice(j, 1);
		rows.push({
			apn: nameOf(x),
			status: "matched",
			a: x,
			b: y,
			sameTypes: typesKey(x) === typesKey(y),
			differs: differs(x, y, families),
		});
		return true;
	};
	for (const x of a)
		if (!take(x, (y) => nameOf(y) === nameOf(x) && typesKey(y) === typesKey(x))) unmatched.push(x);
	for (const x of unmatched)
		if (!take(x, (y) => nameOf(y) === nameOf(x))) rows.push({ apn: nameOf(x), status: "only-a", a: x });
	for (const y of right) rows.push({ apn: nameOf(y), status: "only-b", b: y });
	return rows.toSorted((p, q) => p.apn.localeCompare(q.apn));
}

function rawRows(a: Readonly<Record<string, Json>>, b: Readonly<Record<string, Json>>): RawRow[] {
	return [...new Set([...Object.keys(a), ...Object.keys(b)])].toSorted().flatMap((path): RawRow[] => {
		const va = a[path],
			vb = b[path];
		if (va !== undefined && vb !== undefined)
			return canonical(va) === canonical(vb) ? [] : [{ path, status: "changed", a: va, b: vb }];
		if (va !== undefined) return [{ path, status: "only-a", a: va }];
		return vb === undefined ? [] : [{ path, status: "only-b", b: vb }];
	});
}

/** The Profile as one phone sees it: its variant over the rest. The newest phone's files are the main Profile, so it has none. */
export function profileFor(p: Profile, variantId: string): Profile {
	const v = p.variants.find((x) => x.id === variantId);
	return v === undefined
		? p
		: { ...p, concepts: { ...p.concepts, ...v.concepts }, apns: v.apns, variants: [] };
}

export function compareProfiles(a: Profile, b: Profile): ProfileComparison {
	const families = [decoderFamily(a.source.platform), decoderFamily(b.source.platform)] as const;
	const common = {
		a: sourceKey(a.source),
		b: sourceKey(b.source),
		groups: conceptGroups(a, b),
		apns: apnRows(a.apns, b.apns, families),
	};
	return families[0] === families[1]
		? { ...common, sameFamily: true, raw: rawRows(a.raw, b.raw) }
		: { ...common, sameFamily: false };
}
