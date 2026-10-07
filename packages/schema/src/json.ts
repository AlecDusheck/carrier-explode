/** The one narrowing from decoded `unknown` trees to Json. */

import type { Json } from "./types.ts";

const isPlainObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** `v` as Json; unrepresentable leaves (undefined, bigints, NaN) are dropped, not the whole tree. */
export function toJson(v: unknown): Json | undefined {
	if (v === null || typeof v === "string" || typeof v === "boolean") return v;
	if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
	if (Array.isArray(v))
		return v.flatMap((x: unknown) => {
			const j = toJson(x);
			return j === undefined ? [] : [j];
		});
	if (isPlainObject(v)) {
		const out: Record<string, Json> = {};
		for (const [k, x] of Object.entries(v)) {
			const j = toJson(x);
			if (j !== undefined) out[k] = j;
		}
		return out;
	}
	return undefined;
}
