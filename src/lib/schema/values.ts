/**
 * Building ConceptValues. Readers on both platforms go through these so that
 * every value carries the native settings it was read from and a fidelity, and
 * so that "equal meaning compares equal" is enforced in one place: unordered
 * lists sorted and de-duplicated, empty strings treated as unset.
 */

import type { ConceptValue, FeatureState, Json, NativeRef } from "./types.ts";

export type Fidelity = NonNullable<ConceptValue["fidelity"]>;

/** A value read from native settings. A missing fidelity means "exact". */
export function conceptValue(value: Json, because: readonly NativeRef[], fidelity: Fidelity = "exact"): ConceptValue {
  return { value, because: [...because], ...(fidelity === "exact" ? {} : { fidelity }) };
}

export function stateValue(state: FeatureState, because: readonly NativeRef[], fidelity: Fidelity = "exact"): ConceptValue {
  return { value: state, state, because: [...because], ...(fidelity === "exact" ? {} : { fidelity }) };
}

/** Expressible on the platform, but this source does not set it. */
export const unset = (because: readonly NativeRef[] = []): ConceptValue => ({ value: null, because: [...because] });

/** Sorted, de-duplicated strings: for sets whose native order carries no meaning. */
export const stringSet = <T extends string>(xs: Iterable<T>): T[] => [...new Set(xs)].sort();

export const numberSet = (xs: Iterable<number>): number[] => [...new Set(xs)].sort((a, b) => a - b);

/** A non-empty trimmed string, else undefined: an empty native string means "not set" on both platforms. */
export function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** A finite number, also from a numeric string (iOS writes some timers as strings). */
export function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return undefined;
}

export const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** `sip:conf@x` and `conf@x` name the same server; the scheme is dropped so the platforms compare equal. */
export const sipUri = (v: string): string => v.replace(/^sips?:/i, "");

/** The status bar labels both platforms can draw for advanced 5G, spelled the way the phone shows them. */
export const ICON_LABELS: Readonly<Record<string, string>> = {
  // iOS DataIndicatorOverride* (fields.ts DATA_INDICATOR)
  NRPlus: "5G+",
  NRUWB: "5G UW",
  NRUC: "5G UC",
  LTEPlus: "LTE+",
  LTEA: "LTE-A",
  // Android 5g_icon_configuration_string icon names (AOSP NetworkTypeController)
  "5G_Plus": "5G+",
};

export const iconLabel = (native: string): string => ICON_LABELS[native] ?? native;
