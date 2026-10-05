import { describe, expect, it } from "vitest";

import { canonicalSearch, decodeCursor, encodeCursor, NUMBER_KEY, STRING_KEY } from "../src/page.ts";

describe("cursors", () => {
  it("carry a key through a URL-safe token and back", () => {
    for (const key of ["ATT_US", "Telefónica_es", "ios:carrier:A/B+C"]) {
      const cursor = encodeCursor(key);
      expect(cursor).toMatch(/^[\w-]+$/);
      expect(decodeCursor(cursor, STRING_KEY)).toBe(key);
    }
    expect(decodeCursor(encodeCursor(42), NUMBER_KEY)).toBe(42);
  });

  it("refuse a token of the wrong key type, or none at all", () => {
    expect(() => decodeCursor(encodeCursor(42), STRING_KEY)).toThrow(/Not a cursor/);
    expect(() => decodeCursor("!!", STRING_KEY)).toThrow(/Not a cursor/);
  });
});

describe("canonicalSearch", () => {
  it("orders keys and leaves the default limit out", () => {
    expect(canonicalSearch(new URLSearchParams("limit=5&cursor=x"))).toBe("?cursor=x&limit=5");
    expect(canonicalSearch(new URLSearchParams("limit=100"))).toBe("");
    expect(canonicalSearch(new URLSearchParams(""))).toBe("");
  });
});
