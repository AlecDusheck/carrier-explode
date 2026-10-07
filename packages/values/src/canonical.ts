/** A plain object: not an array, and no class's instance (bytes, a date, a decoder's own scalars). */
export function isRecord(v: unknown): v is Record<string, unknown> {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
	const proto: unknown = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

/** Canonical text of a JSON-like value: object keys sorted, so equal values give equal strings. `memo` caches containers already seen. */
export function canonical(v: unknown, memo?: WeakMap<object, string>): string {
	if (v === null || v === undefined) return String(v);
	if (typeof v !== "object") return JSON.stringify(v);
	const hit = memo?.get(v);
	if (hit !== undefined) return hit;
	const out = Array.isArray(v)
		? `[${v.map((x) => canonical(x, memo)).join(",")}]`
		: isRecord(v)
			? `{${Object.keys(v)
					.toSorted()
					.map((k) => `${JSON.stringify(k)}:${canonical(v[k], memo)}`)
					.join(",")}}`
			: JSON.stringify(v);
	memo?.set(v, out);
	return out;
}
