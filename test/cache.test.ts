import { describe, it, expect } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { cacheControl, rateClass } from "../src/hooks.server.ts";

const event = (opts: { method?: string; remote?: boolean; version?: string; perVisitor?: boolean; url?: string } = {}) => ({
  request: new Request(opts.url ?? "https://carrierexplode.com/carriers/ATT_US", { method: opts.method ?? "GET" }),
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

// A remote call arrives at /_app/remote/<hash>/<name>, and by then event.url has
// been rewritten to the page it came from — so the name comes off the request.
const remote = (name: string) =>
  ({ ...event({ remote: true, url: `https://carrierexplode.com/_app/remote/174z4xf/${name}?payload=%7B%7D` }), route: { id: null }, params: {} });
// Typing the id against the generated union means a route that no longer exists fails the check.
const page = (id: RequestEvent["route"]["id"], version?: string) =>
  ({ ...event({ version }), route: { id }, params: version ? { version } : {} });

describe("rateClass", () => {
  it("puts the fan-out scan in its own budget", () => {
    expect(rateClass(remote("scanKey"))).toBe("scan");
    expect(rateClass(remote("getDiff"))).toBe("diff");
  });

  it("counts anything that can open a bundle together", () => {
    expect(rateClass(remote("getBundle"))).toBe("bundle");
    expect(rateClass(remote("getFile"))).toBe("bundle");
    expect(rateClass(remote("getChanges"))).toBe("bundle");
    expect(rateClass(page("/raw/[kind=kind]/[name]/[version]/[...path]", "ios-27.0"))).toBe("bundle");
    expect(rateClass(page("/compare"))).toBe("bundle");
    expect(rateClass(page("/[kind=kind]/[name]/[version]", "ios-27.0"))).toBe("bundle");
  });

  it("leaves the memoised tables and the plain lists on the base budget", () => {
    expect(rateClass(remote("getIndex"))).toBe("base");
    expect(rateClass(remote("getRelease"))).toBe("base");
    expect(rateClass(remote("getPlmn"))).toBe("base");
    expect(rateClass(page("/[kind=kind]"))).toBe("base");
    expect(rateClass(page("/plmn"))).toBe("base");
  });
});
