/** Key paths over a flattened value (`apns[0].type-mask` → 3): a value rebuilt from its leaves, and wildcard lookups. */

/** A value's leaves by key path. */
export type Flat = Record<string, unknown>;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `a[*].b` matches any index; `a.*.b` matches any single key. */
export function pathPattern(path: string): RegExp | null {
	if (!path.includes("*")) return null;
	const re = path
		.split(/(\[\*\]|\*)/)
		.map((p) => (p === "[*]" ? "\\[\\d+\\]" : p === "*" ? "[^.\\[]+" : esc(p)))
		.join("");
	return new RegExp(`^${re}$`);
}

type Container = Record<string | number, unknown>;

/** Objects and arrays, the containers a path steps into. */
const isContainer = (v: unknown): v is Container => typeof v === "object" && v !== null;

function setPath(root: Container, rest: string, v: unknown): void {
	// rest starts with "." or "[", relative to the container.
	const parts = [...rest.matchAll(/\.([^.[\]]+)|\[(\d+)\]/g)].map(([, name = "", index]) =>
		index !== undefined ? Number(index) : name,
	);
	let cur = root;
	let key: string | number = "";
	for (const p of parts) {
		cur[key] ??= typeof p === "number" ? [] : {};
		const next = cur[key];
		if (!isContainer(next)) throw new Error(`flat map holds a value at a parent of ${rest}`);
		cur = next;
		key = p;
	}
	cur[key] = v;
}

/** Rebuild the value at `path` (leaf or container) from a flat map. */
export function lookup(flat: Flat, path: string): unknown {
	if (path in flat) return flat[path];
	const kids = Object.keys(flat).filter((k) => k.startsWith(path + ".") || k.startsWith(path + "["));
	if (!kids.length) return undefined;
	const root: Container = {};
	for (const k of kids) setPath(root, k.slice(path.length), flat[k]);
	return root[""];
}

/** Values at every path matching `path` (wildcards allowed), in path order. */
export function lookupAll(flat: Flat, path: string): Array<{ path: string; value: unknown }> {
	const re = pathPattern(path);
	if (!re) {
		const v = lookup(flat, path);
		return v === undefined ? [] : [{ path, value: v }];
	}
	return Object.keys(flat)
		.filter((k) => re.test(k))
		.toSorted()
		.map((k) => ({ path: k, value: flat[k] }));
}
