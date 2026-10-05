import { describe, expect, it } from "vitest";

import { purgeTargets } from "../src/worker/purge.ts";

describe("purge configuration", () => {
  it("purges every reader at its purge path with both, skips with neither, and refuses half", () => {
    expect(purgeTargets({ PURGE_ORIGINS: ["https://site", "https://api"], PURGE_TOKEN: "t" }))
      .toEqual({ urls: ["https://site/internal/purge", "https://api/internal/purge"], token: "t" });
    expect(purgeTargets({})).toBeNull();
    expect(purgeTargets({ PURGE_ORIGINS: [] })).toBeNull();
    expect(() => purgeTargets({ PURGE_ORIGINS: ["https://site"] })).toThrow(/PURGE_TOKEN is not/);
    expect(() => purgeTargets({ PURGE_TOKEN: "t" })).toThrow(/PURGE_ORIGINS is not/);
  });
});
