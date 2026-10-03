/** Building and comparing concept readings; both platforms' readers go through these. */

import { canonical } from "./json.ts";
import type { ConceptValue, FeatureState, Fidelity, Json, NativeRef } from "./types.ts";

export type StateReading = Extract<ConceptValue, { kind: "state" }>;
export type Unset = Extract<ConceptValue, { kind: "unset" }>;
export interface ValueReading<T extends Json> {
  readonly kind: "value";
  readonly value: T;
  readonly because: readonly NativeRef[];
  readonly fidelity: Fidelity;
}

export const unset: Unset = { kind: "unset" };

export const stateReading = (state: FeatureState, because: readonly NativeRef[], fidelity: Fidelity = "exact"): StateReading =>
  ({ kind: "state", state, because, fidelity });

export const valueReading = <T extends Json>(value: T, because: readonly NativeRef[], fidelity: Fidelity = "exact"): ValueReading<T> =>
  ({ kind: "value", value, because, fidelity });

/** Equal readings give equal keys; where a reading came from does not count. */
export function readingKey(r: ConceptValue): string {
  if (r.kind === "unset") return "unset";
  return r.kind === "state" ? `state:${r.state}` : `value:${canonical(r.value)}`;
}

/** Sorted and de-duplicated, for sets whose native order means nothing. */
export const stringSet = <T extends string>(xs: Iterable<T>): T[] => [...new Set(xs)].sort();

export const numberSet = (xs: Iterable<number>): number[] => [...new Set(xs)].sort((a, b) => a - b);

/** A non-empty trimmed string: both platforms write "" for unset. */
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

/** `sip:conf@x` and `conf@x` name one server. */
export const sipUri = (v: string): string => v.replace(/^sips?:/i, "");

/** Status bar labels as the phone draws them: iOS DataIndicatorOverride* values and Android 5G icon names. */
const ICON_LABELS: Readonly<Record<string, string>> = {
  NRPlus: "5G+", NRUWB: "5G UW", NRUC: "5G UC", LTEPlus: "LTE+", LTEA: "LTE-A", "5G_Plus": "5G+",
};

export const iconLabel = (native: string): string => ICON_LABELS[native] ?? native;
