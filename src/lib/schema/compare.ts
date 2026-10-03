/**
 * Comparing two Profiles: iOS against Android, or two versions or sources of
 * one platform. Concepts are compared by value (fidelity aside: an "approx"
 * equal is still equal, and the row carries both values so a page can say how
 * sure it is). APNs are matched by name and types, then by name alone. The raw
 * leaf diff only means something within one platform, so it is only produced
 * there.
 */

import { CONCEPT_GROUPS, conceptById, conceptOrder, type ConceptGroup } from "./concepts.ts";
import { canonical } from "./json.ts";
import { sourceKey, type Apn, type ConceptValue, type Json, type Profile } from "./types.ts";

export interface ConceptRow {
  readonly id: string;
  readonly a?: ConceptValue;
  readonly b?: ConceptValue;
  /** Both sides express it and the values are equal. */
  readonly same: boolean;
  /** Only one side can express it at all (not merely leaves it unset). */
  readonly onlyA: boolean;
  readonly onlyB: boolean;
}

export interface ConceptGroupRows {
  readonly group: ConceptGroup;
  readonly rows: readonly ConceptRow[];
}

type ApnField = Exclude<keyof Apn, "path" | "apn">;

export interface ApnRow {
  /** Lower-cased APN name. */
  readonly apn: string;
  readonly a?: Apn;
  readonly b?: Apn;
  /** Matched on name and identical types. */
  readonly exact: boolean;
  /** Fields whose values differ, among those both sides state (or, within one platform, either side states). */
  readonly differs: readonly ApnField[];
}

export interface RawRow {
  readonly path: string;
  readonly a?: Json;
  readonly b?: Json;
}

export interface ProfileComparison {
  readonly a: string;
  readonly b: string;
  readonly samePlatform: boolean;
  readonly groups: readonly ConceptGroupRows[];
  readonly apns: readonly ApnRow[];
  /** Leaves that differ; only when both profiles are of one platform. */
  readonly raw?: readonly RawRow[];
  readonly counts: { readonly same: number; readonly different: number; readonly onlyA: number; readonly onlyB: number };
}

const GROUP_OF_UNKNOWN: ConceptGroup = "features";

function conceptRows(a: Profile, b: Profile): ConceptGroupRows[] {
  const ids = [...new Set([...Object.keys(a.concepts), ...Object.keys(b.concepts)])].sort((x, y) => conceptOrder(x) - conceptOrder(y) || x.localeCompare(y));
  const byGroup = new Map<ConceptGroup, ConceptRow[]>();
  for (const id of ids) {
    const va = a.concepts[id], vb = b.concepts[id];
    const row: ConceptRow = {
      id,
      ...(va !== undefined ? { a: va } : {}),
      ...(vb !== undefined ? { b: vb } : {}),
      same: va !== undefined && vb !== undefined && canonical(va.value) === canonical(vb.value),
      onlyA: va !== undefined && vb === undefined,
      onlyB: va === undefined && vb !== undefined,
    };
    const group = conceptById(id)?.group ?? GROUP_OF_UNKNOWN;
    byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
  }
  return CONCEPT_GROUPS.flatMap((group) => {
    const rows = byGroup.get(group);
    return rows ? [{ group, rows }] : [];
  });
}

const APN_FIELDS: readonly ApnField[] = [
  "label", "types", "protocol", "roamingProtocol", "auth", "user", "hasPassword", "proxy", "port",
  "mmsc", "mmsProxy", "mmsPort", "mtu", "bearers",
];

/** Labels are Android's alone; across platforms they would always differ. */
const CROSS_PLATFORM_FIELDS = APN_FIELDS.filter((f) => f !== "label");

/** Types and bearers are sets: order carries no meaning. */
const fieldText = (v: Apn[ApnField]): string => (v === undefined ? "" : canonical(Array.isArray(v) ? [...v].sort() : v));

function apnDiffers(x: Apn, y: Apn, samePlatform: boolean): ApnField[] {
  const fields = samePlatform ? APN_FIELDS : CROSS_PLATFORM_FIELDS;
  return fields.filter((f) => {
    const [vx, vy] = [x[f], y[f]];
    // Across platforms a field one side cannot state is not a difference.
    if (!samePlatform && (vx === undefined || vy === undefined)) return false;
    return fieldText(vx) !== fieldText(vy);
  });
}

const typesKey = (a: Apn): string => [...a.types].sort().join(",");

function apnRows(a: readonly Apn[], b: readonly Apn[], samePlatform: boolean): ApnRow[] {
  const left = [...a], right = [...b];
  const rows: ApnRow[] = [];
  const take = (match: (x: Apn, y: Apn) => boolean, exact: boolean): void => {
    for (let i = 0; i < left.length; i++) {
      const x = left[i];
      const j = x === undefined ? -1 : right.findIndex((y) => match(x, y));
      const y = right[j];
      if (x === undefined || y === undefined) continue;
      rows.push({ apn: x.apn.toLowerCase(), a: x, b: y, exact, differs: apnDiffers(x, y, samePlatform) });
      left.splice(i--, 1);
      right.splice(j, 1);
    }
  };
  const sameName = (x: Apn, y: Apn): boolean => x.apn.toLowerCase() === y.apn.toLowerCase();
  take((x, y) => sameName(x, y) && typesKey(x) === typesKey(y), true);
  take(sameName, false);
  for (const x of left) rows.push({ apn: x.apn.toLowerCase(), a: x, exact: false, differs: [] });
  for (const y of right) rows.push({ apn: y.apn.toLowerCase(), b: y, exact: false, differs: [] });
  return rows.sort((p, q) => p.apn.localeCompare(q.apn));
}

function rawRows(a: Readonly<Record<string, Json>>, b: Readonly<Record<string, Json>>): RawRow[] {
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return paths.flatMap((path): RawRow[] => {
    const va = a[path], vb = b[path];
    if (va !== undefined && vb !== undefined && canonical(va) === canonical(vb)) return [];
    return [{ path, ...(va !== undefined ? { a: va } : {}), ...(vb !== undefined ? { b: vb } : {}) }];
  });
}

export function compareProfiles(a: Profile, b: Profile): ProfileComparison {
  const samePlatform = a.source.platform === b.source.platform;
  const groups = conceptRows(a, b);
  const rows = groups.flatMap((g) => g.rows);
  return {
    a: sourceKey(a.source),
    b: sourceKey(b.source),
    samePlatform,
    groups,
    apns: apnRows(a.apns, b.apns, samePlatform),
    ...(samePlatform ? { raw: rawRows(a.raw, b.raw) } : {}),
    counts: {
      same: rows.filter((r) => r.same).length,
      different: rows.filter((r) => r.a !== undefined && r.b !== undefined && !r.same).length,
      onlyA: rows.filter((r) => r.onlyA).length,
      onlyB: rows.filter((r) => r.onlyB).length,
    },
  };
}
