import { describe, it, expect } from "vitest";
import {
	canonical,
	compareDotted,
	diffValues,
	isRecord,
	lookupAll,
	summariseDiff,
	versionSegments,
} from "../src/index.ts";

/** A record by its name, anything else by its value. */
const byName = (v: unknown): string | null =>
	typeof v === "object" && v !== null && "name" in v ? `n ${String(v.name)}` : null;

/** A record by its kind, anything else by its value. */
const byKind = (v: unknown): string | null =>
	typeof v === "object" && v !== null && "t" in v ? `t ${String(v.t)}` : null;

describe("diffValues", () => {
	it("walks nested dicts and reports each leaf", () => {
		const rows = diffValues({ a: 1, b: { c: 2 }, d: [1, 2] }, { a: 1, b: { c: 3 }, e: 5, d: [1, 3] });
		expect(rows).toEqual([
			{ path: "b.c", kind: "changed", a: 2, b: 3 },
			{ path: "d[1]", kind: "changed", a: 2, b: 3 },
			{ path: "e", kind: "added", b: 5 },
		]);
	});

	it("aligns arrays so an insertion is one added row, not a cascade", () => {
		const A = [
			{ apn: "a", t: 1 },
			{ apn: "b", t: 2 },
			{ apn: "c", t: 3 },
		];
		const B = [
			{ apn: "a", t: 1 },
			{ apn: "new", t: 9 },
			{ apn: "b", t: 2 },
			{ apn: "c", t: 4 },
		];
		expect(diffValues(A, B)).toEqual([
			{ path: "[1]", kind: "added", b: { apn: "new", t: 9 } },
			{ path: "[3].t", kind: "changed", a: 3, b: 4 },
		]);
	});

	it("reports a removal at the old index", () => {
		expect(diffValues(["x", "y", "z"], ["x", "z"])).toEqual([{ path: "[1]", kind: "removed", a: "y" }]);
	});

	it("pairs unmatched entries between anchors and diffs them in place", () => {
		expect(diffValues([{ k: 1 }, "s"], [{ k: 2 }, "s"])).toEqual([
			{ path: "[0].k", kind: "changed", a: 1, b: 2 },
		]);
	});

	it("treats key order as irrelevant", () => {
		expect(diffValues({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
	});

	it("counts rows by kind", () => {
		expect(summariseDiff(diffValues({ a: 1, b: 2 }, { a: 1, b: 3 }))).toEqual({
			added: 0,
			removed: 0,
			changed: 1,
			same: 0,
		});
	});

	it("aligns only the middle once a common head and tail are trimmed", () => {
		const big = Array.from({ length: 3000 }, (_, i) => i);
		expect(diffValues(big, [...big.slice(0, 1500), -1, ...big.slice(1500)])).toEqual([
			{ path: "[1500]", kind: "added", b: -1 },
		]);
	});

	it("falls back to index alignment past the LCS budget", () => {
		const big = Array.from({ length: 2100 }, (_, i) => i);
		const rows = diffValues(big, [...big.slice(0, 2000), -1, ...big.slice(2001)]);
		expect(rows).toEqual([{ path: "[2000]", kind: "changed", a: 2000, b: -1 }]);
	});
	it("pairs unmatched items only by key when given one: other lists are added and removed, not changed in place", () => {
		expect(diffValues(["a", "b"], ["c"], undefined, [byName])).toEqual([
			{ path: "[0]", kind: "removed", a: "a" },
			{ path: "[1]", kind: "removed", a: "b" },
			{ path: "[0]", kind: "added", b: "c" },
		]);
		expect(
			diffValues([{ name: "x", m: 1 }, { name: "y" }], [{ name: "y" }, { name: "x", m: 2 }], undefined, [
				byName,
			]),
		).toEqual([{ path: "[1].m", kind: "changed", a: 1, b: 2 }]);
	});

	it("still shows a reordered list of plain values: they pair by no key", () => {
		expect(diffValues([1, 2], [2, 1], undefined, [byName])).toEqual([
			{ path: "[0]", kind: "removed", a: 1 },
			{ path: "[1]", kind: "added", b: 1 },
		]);
	});

	it("pairs what one key leaves unpaired by the next", () => {
		expect(
			diffValues([{ name: "a", t: "ims" }], [{ name: "b", t: "ims" }], undefined, [byName, byKind]),
		).toEqual([{ path: "[0].name", kind: "changed", a: "a", b: "b" }]);
	});
});

describe("canonical", () => {
	it("writes dicts with sorted keys", () => {
		expect(canonical({ b: [1, { d: 2, c: 3 }], a: null })).toBe('{"a":null,"b":[1,{"c":3,"d":2}]}');
	});
});

describe("isRecord", () => {
	it("is true of plain objects only", () => {
		expect([{}, Object.create(null), [], new Uint8Array(1), new Date(0), null, "x"].map(isRecord)).toEqual([
			true,
			true,
			false,
			false,
			false,
			false,
			false,
		]);
	});
});

describe("lookupAll", () => {
	it("rebuilds a container and matches wildcards in path order", () => {
		const flat = { "apns[0].type": 1, "apns[1].type": 3, "x.y": true };
		expect(lookupAll(flat, "x")).toEqual([{ path: "x", value: { y: true } }]);
		expect(lookupAll(flat, "apns[*].type")).toEqual([
			{ path: "apns[0].type", value: 1 },
			{ path: "apns[1].type", value: 3 },
		]);
	});
});

describe("versionSegments", () => {
	it("splits a dotted version into numbers, a non-numeric segment as -1", () => {
		expect(versionSegments("10.3.2")).toEqual([10, 3, 2]);
		expect(versionSegments("0")).toEqual([0]);
		expect([versionSegments("legacy"), versionSegments(""), versionSegments("Watch 1")]).toEqual([
			[-1],
			[-1],
			[-1],
		]);
	});
});

describe("compareDotted", () => {
	it("orders versions numerically by segment, a missing segment as 0", () => {
		expect(["9.1", "72.0", "10.0", "79000000034", "72"].toSorted(compareDotted)).toEqual([
			"9.1",
			"10.0",
			"72.0",
			"72",
			"79000000034",
		]);
	});
});
