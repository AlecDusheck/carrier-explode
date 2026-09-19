import { describe, it, expect } from "vitest";
import { cacheControl } from "../src/hooks.server.ts";

const event = (opts: { method?: string; remote?: boolean; version?: string; perVisitor?: boolean } = {}) => ({
  request: new Request("https://carrierexplode.com/carriers/ATT_US", { method: opts.method ?? "GET" }),
  isRemoteRequest: opts.remote ?? false,
  params: opts.version ? { version: opts.version } : {},
  locals: { perVisitor: opts.perVisitor },
});

describe("cacheControl", () => {
  it("holds a pinned version far longer than a page that tracks newest", () => {
    expect(cacheControl(event({ version: "ios-27.0" }), 200)).toContain("s-maxage=86400");
    expect(cacheControl(event(), 200)).toContain("s-maxage=600");
  });

  it("caches the redirect off /", () => {
    expect(cacheControl(event(), 307)).toContain("s-maxage=600");
  });

  it("keeps a 404 briefly and never keeps an error", () => {
    expect(cacheControl(event({ version: "ios-27.0" }), 404)).toContain("s-maxage=60");
    expect(cacheControl(event(), 500)).toBe("private, no-store");
  });

  it("never shares a page that looked at the visitor", () => {
    expect(cacheControl(event({ perVisitor: true }), 200)).toBe("private, no-store");
    expect(cacheControl(event({ perVisitor: true, version: "ios-27.0" }), 200)).toBe("private, no-store");
  });

  it("shares nothing that is not a plain GET for a page", () => {
    expect(cacheControl(event({ method: "POST" }), 200)).toBe("private, no-store");
    expect(cacheControl(event({ remote: true }), 200)).toBe("private, no-store");
  });
});
