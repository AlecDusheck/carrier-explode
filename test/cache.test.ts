import { describe, it, expect } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { cachePolicy, rateClass, remoteQuery } from "../src/hooks.server.ts";

const event = (opts: { method?: string; remote?: boolean; version?: string; perVisitor?: boolean; url?: string } = {}) => ({
  request: new Request(opts.url ?? "https://carrierexplode.com/carriers/ATT_US", { method: opts.method ?? "GET" }),
  isRemoteRequest: opts.remote ?? false,
  params: opts.version ? { version: opts.version } : {},
  locals: { perVisitor: opts.perVisitor },
});

describe("cachePolicy", () => {
  const edge = (o: Parameters<typeof event>[0] = {}, status = 200) => cachePolicy({ ...event(o), route: { id: "/[kind=kind]/[name]" } }, status);

  it("addresses the edge, and tells browsers to revalidate", () => {
    // s-maxage would disable stale-while-revalidate, and a plain public
    // Cache-Control would let the adapter's un-purgeable cache keep the page.
    const p = edge({ version: "ios-27.0" });
    expect(p.edge).toBe("max-age=86400, stale-while-revalidate=2592000");
    expect(p.browser).toBe("no-cache");
    expect(p.browser).not.toContain("public");
  });

  it("holds a pinned version far longer than a page that tracks newest", () => {
    expect(edge({ version: "ios-27.0" }).edge).toContain("max-age=86400");
    expect(edge().edge).toContain("max-age=21600");
  });

  it("tags pages rendered from modem package summaries so a rebuild can purge them", () => {
    const at = (id: RequestEvent["route"]["id"], version?: string) => cachePolicy({ ...event({ version }), route: { id } }, 200).tags;
    expect(at("/baseband/[build]")).toContain("baseband");
    expect(at("/[kind=kind]/[name]/[version]/baseband", "ios-27.0")).toEqual(["pinned", "baseband"]);
    expect(at("/[kind=kind]/[name]/[version]/changes", "ios-27.0")).not.toContain("baseband");
    // It lists every image's modem packages.
    expect(at("/sitemap.xml")).toContain("baseband");
  });

  it("tags what a purge has to be able to name", () => {
    expect(edge({ version: "ios-27.0" }).tags).toEqual(["pinned"]);
    expect(edge().tags).toEqual(["latest"]);
  });

  it("caches the redirect off /", () => {
    expect(edge({}, 307).edge).toContain("max-age=21600");
  });

  it("keeps a 404 briefly and never keeps an error", () => {
    expect(edge({ version: "ios-27.0" }, 404).edge).toBe("max-age=60");
    expect(edge({}, 500)).toEqual({ browser: "private, no-store" });
  });

  it("never shares a page that looked at the visitor", () => {
    expect(edge({ perVisitor: true })).toEqual({ browser: "private, no-store" });
    expect(edge({ perVisitor: true, version: "ios-27.0" })).toEqual({ browser: "private, no-store" });
  });

  it("shares nothing that is not a plain GET for a page", () => {
    expect(edge({ method: "POST" })).toEqual({ browser: "private, no-store" });
    expect(edge({ remote: true })).toEqual({ browser: "private, no-store" });
  });

  it("lets a browser hold a bundle member, but no cache it cannot purge", () => {
    const p = cachePolicy({ ...event({ version: "ios-27.0" }), route: { id: "/raw/[kind=kind]/[name]/[version]/[...path]" } }, 200);
    expect(p.browser).toBe("private, max-age=86400");
    expect(p.edge).toBe("max-age=2592000");
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
  const rate = (e: ReturnType<typeof remote> | ReturnType<typeof page>) => rateClass(e, remoteQuery(e));

  it("puts the fan-out scan in its own budget", () => {
    expect(rate(remote("scanKey"))).toBe("scan");
    expect(rate(remote("getComparison"))).toBe("diff");
    expect(rate(remote("getBasebandDiff"))).toBe("diff");
  });

  it("counts anything that can open a bundle together", () => {
    expect(rate(remote("getBundle"))).toBe("bundle");
    expect(rate(remote("getFile"))).toBe("bundle");
    expect(rate(remote("getBasebandDefaults"))).toBe("bundle");
    expect(rate(remote("getPhoneOverrides"))).toBe("bundle");
    expect(rate(page("/raw/[kind=kind]/[name]/[version]/[...path]", "ios-27.0"))).toBe("bundle");
    expect(rate(page("/compare"))).toBe("bundle");
    expect(rate(page("/[kind=kind]/[name]/[version]", "ios-27.0"))).toBe("bundle");
  });

  it("leaves the cached tables and the plain lists on the base budget", () => {
    expect(rate(remote("getIndex"))).toBe("base");
    expect(rate(remote("getRelease"))).toBe("base");
    expect(rate(remote("getBaseband"))).toBe("base");
    expect(rate(remote("getPlmn"))).toBe("base");
    expect(rate(remote("notAQuery"))).toBe("base");
    expect(rate(page("/[kind=kind]"))).toBe("base");
    expect(rate(page("/plmn"))).toBe("base");
  });
});

describe("remoteQuery", () => {
  it("lets only the queries that read nobody be shared", () => {
    expect(remoteQuery(remote("getStats"))?.shared).toBe(true);
    expect(remoteQuery(remote("guessCarrier"))?.shared).toBeUndefined();
    expect(remoteQuery(page("/[kind=kind]"))).toBeNull();
  });
});
