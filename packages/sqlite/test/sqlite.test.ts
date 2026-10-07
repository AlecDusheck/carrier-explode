/** Fixtures from test/fixtures/make.py: 512-byte pages, so `many` is a three-level B-tree and `big` spans overflow chains. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openSqlite, SqliteError } from "../src/index.ts";

const fixture = (name: string): Uint8Array => readFileSync(join(import.meta.dirname, "fixtures", name));
const db = openSqlite(fixture("main.db"));

describe("openSqlite", () => {
	it("decodes every serial type, and an INTEGER PRIMARY KEY from the rowid", () => {
		const rows = [...db.rows("kinds")];
		expect(rows.map((r) => r["id"])).toEqual(rows.map((_, i) => i + 10));
		expect(Object.fromEntries(rows.map((r) => [String(r["label"]), r["v"]]))).toEqual({
			null: null,
			zero: 0,
			one: 1,
			int8: -128,
			int16: 32767,
			int24: -8388608,
			int32: 2147483647,
			int48: -(2 ** 47),
			int64: 2n ** 62n + 1n,
			int64min: -(2n ** 63n),
			real: -2.5,
			text: "héllo, wörld",
			"empty text": "",
			blob: new Uint8Array([0, 0xff, 0x10]),
			"empty blob": new Uint8Array(),
		});
	});

	it("follows overflow chains", () => {
		const [big, small] = [...db.rows("big", { body: "text", data: "blob" })];
		expect(big?.body).toBe("x".repeat(3000));
		expect(big?.data).toEqual(Uint8Array.from({ length: 20000 }, (_, i) => i % 251));
		expect(small).toEqual({ body: "short", data: new Uint8Array([1]) });
	});

	it("walks a multi-level B-tree in rowid order", () => {
		const rows = [...db.rows("many", { n: "integer", s: "text" })];
		expect(rows).toHaveLength(5000);
		expect(rows.every((r, i) => r.n === i && r.s === `row ${String(i).padStart(5, "0")}`)).toBe(true);
	});

	it("parses quoted names, constraints, comments and a table-level INTEGER PRIMARY KEY", () => {
		expect([...db.rows("odd table")]).toEqual([{ "col one": "1,2", "col,two": 7, three: 4 }]);
		expect([...db.rows("keyed")]).toEqual([{ k: 42, v: "answer" }]);
	});

	it("reads UTF-16 databases", () => {
		for (const name of ["utf-16le.db", "utf-16be.db"]) {
			expect([...openSqlite(fixture(name)).rows("t", { s: "text" })]).toEqual([{ s: "Grüße 日本" }]);
		}
	});

	it("checks typed rows against their spec", () => {
		expect(() => [...db.rows("kinds", { v: "text" })]).toThrow(SqliteError);
		expect(() => [...db.rows("kinds", { missing: "text" })]).toThrow(/no column missing/);
		expect(() => [...db.rows("kinds", { v: "integer?" })]).toThrow(/kinds\.v holds bigint/);
		expect(() => db.rows("nope")).toThrow(/no table nope/);
	});

	it("rejects what is not SQLite or is cut short", () => {
		expect(() => openSqlite(new Uint8Array(512))).toThrow(/not an SQLite 3 file/);
		const cut = fixture("main.db").slice(0, 512 * 20);
		expect(() => [...openSqlite(cut).rows("many")]).toThrow(/outside the file's 20 pages/);
	});
});
