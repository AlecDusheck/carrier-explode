/**
 * Decoded native values arrive as `unknown` (plist trees, protobuf configs); a
 * Profile stores Json. This is the one narrowing between the two, plus the
 * canonical text every equality test in the schema goes through.
 */

import type { Json } from "./types.ts";

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `v` as Json, or undefined when it is not representable (undefined, functions,
 * bigints, non-finite numbers). Containers keep their representable members only:
 * a decoded tree is never partly rejected for one odd leaf.
 */
export function toJson(v: unknown): Json | undefined {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) return v.flatMap((x) => { const j = toJson(x); return j === undefined ? [] : [j]; });
  if (isPlainObject(v)) {
    const out: { [k: string]: Json } = {};
    for (const [k, x] of Object.entries(v)) {
      const j = toJson(x);
      if (j !== undefined) out[k] = j;
    }
    return out;
  }
  return undefined;
}

/** Canonical text of a Json value: object keys sorted, so equal values give equal strings. */
export function canonical(v: Json): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k] ?? null)}`).join(",")}}`;
}

export const sameJson = (a: Json, b: Json): boolean => canonical(a) === canonical(b);
