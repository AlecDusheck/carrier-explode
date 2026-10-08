import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { API_PAGE_LIMITS: { default: 100, max: 500 } } }));

const { canonicalSearch, decodeCursor, encodeCursor, SOURCE_KEY, STRING_KEY } =
	await import("../src/page.ts");

describe("cursors", () => {
	it("carry a key through a URL-safe token and back", () => {
		for (const key of ["ATT_US", "Telefónica_es", "ios:carrier:A/B+C"]) {
			const cursor = encodeCursor(key);
			expect(cursor).toMatch(/^[\w-]+$/);
			expect(decodeCursor(cursor, STRING_KEY)).toBe(key);
		}
		expect(decodeCursor(encodeCursor("android:carrier:att_us"), SOURCE_KEY)).toBe("android:carrier:att_us");
	});

	it("refuse a token of the wrong key type, or none at all", () => {
		expect(() => decodeCursor(encodeCursor("ATT_US"), SOURCE_KEY)).toThrow(/Not a cursor/);
		expect(() => decodeCursor(btoa("42"), STRING_KEY)).toThrow(/Not a cursor/);
		expect(() => decodeCursor("!!", STRING_KEY)).toThrow(/Not a cursor/);
	});
});

describe("canonicalSearch", () => {
	it("orders keys and leaves the default limit out", () => {
		expect(canonicalSearch(new URLSearchParams("limit=5&cursor=x"))).toBe("?cursor=x&limit=5");
		expect(canonicalSearch(new URLSearchParams("limit=100"))).toBe("");
		expect(canonicalSearch(new URLSearchParams(""))).toBe("");
	});

	it("leaves `,` and `:` unencoded, so a typed query needs no redirect", () => {
		expect(canonicalSearch(new URLSearchParams("b=samsung%3Acarrier%3AATT&a=ios:carrier:ATT_US"))).toBe(
			"?a=ios:carrier:ATT_US&b=samsung:carrier:ATT",
		);
		expect(canonicalSearch(new URLSearchParams("device=iPhone18%2C1"))).toBe("?device=iPhone18,1");
	});
});
