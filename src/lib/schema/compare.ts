/** Two Profiles side by side: concepts by reading, APNs by name and types, raw leaves only within one decoder family. */

import { CONCEPT_GROUPS, conceptById, conceptOrder, type ConceptGroup } from "./concepts.ts";
import { canonical } from "./json.ts";
import { decoderFamily, sourceKey, type Apn, type ConceptValue, type Json, type Profile } from "./types.ts";
import { readingKey } from "./values.ts";

/** How the two sides stand on one concept; `one-sided` means only that side can express it at all. */
export type ConceptRow =
  | { readonly id: string; readonly status: "same" | "different"; readonly a: ConceptValue; readonly b: ConceptValue }
  | { readonly id: string; readonly status: "only-a"; readonly a: ConceptValue }
  | { readonly id: string; readonly status: "only-b"; readonly b: ConceptValue };

export interface ConceptGroupRows {
  readonly group: ConceptGroup;
  readonly rows: readonly ConceptRow[];
}

type ApnField = Exclude<keyof Apn, "path" | "apn">;

export type ApnRow =
  | { readonly apn: string; readonly status: "matched"; readonly a: Apn; readonly b: Apn; readonly sameTypes: boolean; readonly differs: readonly ApnField[] }
  | { readonly apn: string; readonly status: "only-a"; readonly a: Apn }
  | { readonly apn: string; readonly status: "only-b"; readonly b: Apn };

export type RawRow =
  | { readonly path: string; readonly status: "changed"; readonly a: Json; readonly b: Json }
  | { readonly path: string; readonly status: "only-a"; readonly a: Json }
  | { readonly path: string; readonly status: "only-b"; readonly b: Json };

export type ProfileComparison = {
  readonly a: string;
  readonly b: string;
  readonly groups: readonly ConceptGroupRows[];
  readonly apns: readonly ApnRow[];
} & ({ readonly sameFamily: true; readonly raw: readonly RawRow[] } | { readonly sameFamily: false });

function conceptRow(id: string, a: ConceptValue | undefined, b: ConceptValue | undefined): ConceptRow | undefined {
  if (a && b) return { id, status: readingKey(a) === readingKey(b) ? "same" : "different", a, b };
  if (a) return { id, status: "only-a", a };
  return b ? { id, status: "only-b", b } : undefined;
}

function conceptGroups(a: Profile, b: Profile): ConceptGroupRows[] {
  const ids = [...new Set([...Object.keys(a.concepts), ...Object.keys(b.concepts)])].sort((x, y) => conceptOrder(x) - conceptOrder(y) || x.localeCompare(y));
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

const APN_FIELDS: readonly ApnField[] = [
  "label", "types", "protocol", "roamingProtocol", "auth", "user", "hasPassword", "proxy", "port", "mmsc", "mmsProxy", "mmsPort", "mtu", "bearers",
];

/** Types and bearers are sets. */
const fieldText = (v: Apn[ApnField]): string => (v === undefined ? "" : canonical(typeof v === "object" ? [...v].sort() : v));

/** Across platforms, a field one side cannot state (and Android's labels) is not a difference. */
function differs(x: Apn, y: Apn, sameFamily: boolean): ApnField[] {
  return APN_FIELDS.filter((f) => {
    if (!sameFamily && (f === "label" || x[f] === undefined || y[f] === undefined)) return false;
    return fieldText(x[f]) !== fieldText(y[f]);
  });
}

const typesKey = (a: Apn): string => [...a.types].sort().join(",");
const nameOf = (a: Apn): string => a.apn.toLowerCase();

function apnRows(a: readonly Apn[], b: readonly Apn[], sameFamily: boolean): ApnRow[] {
  const right = [...b];
  const rows: ApnRow[] = [];
  const unmatched: Apn[] = [];
  const take = (x: Apn, match: (y: Apn) => boolean): boolean => {
    const j = right.findIndex(match);
    const y = right[j];
    if (y === undefined) return false;
    right.splice(j, 1);
    rows.push({ apn: nameOf(x), status: "matched", a: x, b: y, sameTypes: typesKey(x) === typesKey(y), differs: differs(x, y, sameFamily) });
    return true;
  };
  for (const x of a) if (!take(x, (y) => nameOf(y) === nameOf(x) && typesKey(y) === typesKey(x))) unmatched.push(x);
  for (const x of unmatched) if (!take(x, (y) => nameOf(y) === nameOf(x))) rows.push({ apn: nameOf(x), status: "only-a", a: x });
  for (const y of right) rows.push({ apn: nameOf(y), status: "only-b", b: y });
  return rows.sort((p, q) => p.apn.localeCompare(q.apn));
}

function rawRows(a: Readonly<Record<string, Json>>, b: Readonly<Record<string, Json>>): RawRow[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((path): RawRow[] => {
    const va = a[path], vb = b[path];
    if (va !== undefined && vb !== undefined) return canonical(va) === canonical(vb) ? [] : [{ path, status: "changed", a: va, b: vb }];
    if (va !== undefined) return [{ path, status: "only-a", a: va }];
    return vb === undefined ? [] : [{ path, status: "only-b", b: vb }];
  });
}

export function compareProfiles(a: Profile, b: Profile): ProfileComparison {
  const common = { a: sourceKey(a.source), b: sourceKey(b.source), groups: conceptGroups(a, b) };
  return decoderFamily(a.source.platform) === decoderFamily(b.source.platform)
    ? { ...common, apns: apnRows(a.apns, b.apns, true), sameFamily: true, raw: rawRows(a.raw, b.raw) }
    : { ...common, apns: apnRows(a.apns, b.apns, false), sameFamily: false };
}
