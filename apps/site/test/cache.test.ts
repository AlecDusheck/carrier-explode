import { describe, it, expect } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import type { CachePolicy } from "@carrier-explode/storage";
import { cachePolicy, responsePolicy, type CacheTtl } from "../src/lib/server/cache-policy.ts";
import { rateClass, remoteQuery } from "../src/lib/server/rate.ts";

const VERSION = "/[platform=platform]/[kind=kind]/[name]/[[line=line]]/[version=version]" as const;
const TAB = `${VERSION}/[tab=tab]/[...path]` as const;
const RAW =
	"/raw/[platform=appleplatform]/[kind=kind]/[name]/[[line=line]]/[version=version]/[...path]" as const;

const event = (
	opts: {
		method?: string;
		remote?: boolean;
		version?: string;
		perVisitor?: boolean;
		url?: string;
	} = {},
) => ({
	request: new Request(opts.url ?? "https://carrierexplode.com/carriers/ios/ATT_US", {
		method: opts.method ?? "GET",
	}),
	isRemoteRequest: opts.remote ?? false,
	params: opts.version ? { version: opts.version } : {},
	locals: { perVisitor: opts.perVisitor ?? false },
});

const TTL: CacheTtl = {
	pinned: 21600,
	latest: 3600,
	missing: 60,
	raw: 2592000,
	rawBrowser: 86400,
	staleWhileRevalidate: 86400,
	derived: 2592000,
};

/** The max-age a Cache-Control value grants, or NaN when it grants none. */
/** What the edge may keep of a policy, or undefined when it may keep nothing. */
const edgeOf = (p: CachePolicy | null): string | undefined =>
	p !== null && "edge" in p ? p.edge : undefined;

const maxAge = (v?: string) => Number(/(?:^|[ ,])max-age=(\d+)/.exec(v ?? "")?.[1]);

describe("cachePolicy", () => {
	const edge = (o: Parameters<typeof event>[0] = {}, status = 200) =>
		cachePolicy({ ...event(o), route: { id: TAB } }, status, TTL);

	it("addresses the edge, and tells browsers to revalidate", () => {
		// s-maxage would disable stale-while-revalidate, and a plain public
		// Cache-Control would let shared caches a purge cannot reach keep the page.
		const p = edge({ version: "72.0" });
		expect(edgeOf(p)).toContain("stale-while-revalidate");
		expect(edgeOf(p)).not.toContain("s-maxage");
		expect(p.browser).toBe("no-cache");
		expect(p.browser).not.toContain("public");
	});

	it("holds a pinned version longer than a page that tracks newest", () => {
		expect(maxAge(edgeOf(edge({ version: "72.0" })))).toBeGreaterThan(maxAge(edgeOf(edge())));
	});

	it("caches the redirect off /", () => {
		expect(maxAge(edgeOf(edge({}, 307)))).toBeGreaterThan(0);
	});

	it("keeps a 404 briefly and never keeps an error", () => {
		expect(maxAge(edgeOf(edge({ version: "72.0" }, 404)))).toBeLessThan(
			maxAge(edgeOf(edge({ version: "72.0" }))),
		);
		expect(edge({}, 500)).toEqual({ browser: "private, no-store" });
	});

	it("never shares a page that looked at the visitor", () => {
		expect(edge({ perVisitor: true })).toEqual({ browser: "private, no-store" });
		expect(edge({ perVisitor: true, version: "72.0" })).toEqual({ browser: "private, no-store" });
	});

	it("shares nothing that is not a plain GET for a page", () => {
		expect(edge({ method: "POST" })).toEqual({ browser: "private, no-store" });
		expect(edge({ remote: true })).toEqual({ browser: "private, no-store" });
	});

	it("lets a browser hold a bundle member, but no cache it cannot purge", () => {
		const p = cachePolicy({ ...event({ version: "72.0" }), route: { id: RAW } }, 200, TTL);
		expect(p.browser).toMatch(/^private, /);
		expect(maxAge(p.browser)).toBeGreaterThan(0);
		expect(maxAge(edgeOf(p))).toBeGreaterThan(0);
	});
});

// A remote call arrives at /_app/remote/<hash>/<name>, and by then event.url has
// been rewritten to the page it came from, so the name comes off the request.
const remote = (name: string) => ({
	...event({ remote: true, url: `https://carrierexplode.com/_app/remote/174z4xf/${name}?payload=%7B%7D` }),
	route: { id: null },
	params: {},
});
// Typing the id against the generated union means a route that no longer exists fails the check.
const page = (id: RequestEvent["route"]["id"], version?: string) => ({
	...event(version === undefined ? {} : { version }),
	route: { id },
	params: version ? { version } : {},
});

const rate = (e: ReturnType<typeof remote> | ReturnType<typeof page>) => rateClass(e, remoteQuery(e));

describe("rateClass", () => {
	it("puts the fan-out scan in its own budget", () => {
		expect(rate(remote("scanKey"))).toBe("scan");
		expect(rate(remote("getComparison"))).toBe("diff");
		expect(rate(remote("getBasebandDiff"))).toBe("diff");
	});

	it("counts anything that can open a bundle together", () => {
		expect(rate(remote("getAppleBundle"))).toBe("bundle");
		expect(rate(remote("getAppleFile"))).toBe("bundle");
		expect(rate(remote("getBasebandDefaults"))).toBe("bundle");
		expect(rate(remote("getBundleOverrides"))).toBe("bundle");
		expect(rate(page(RAW, "72.0"))).toBe("bundle");
		expect(rate(page("/compare"))).toBe("bundle");
		expect(rate(page(VERSION, "72.0"))).toBe("bundle");
	});

	it("leaves the cached tables and the plain lists on the base budget", () => {
		expect(rate(remote("getIndex"))).toBe("base");
		expect(rate(remote("getRelease"))).toBe("base");
		expect(rate(remote("getBaseband"))).toBe("base");
		expect(rate(remote("notAQuery"))).toBe("base");
		expect(rate(page("/[platform=platform]/[kind=kind]"))).toBe("base");
	});
});

/** SvelteKit answers a remote query with a 200 either way. */
const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const result = () => answer({ type: "result", data: "[]" });
const failed = (status: number) => answer({ type: "error", error: { status, message: "no" } });

describe("remote responses", () => {
	const policy = (o: Parameters<typeof event>[0], response = result()) =>
		responsePolicy({ ...event({ remote: true, ...o }), route: { id: null } }, response, TTL);

	it("shares an answer that read nobody at the edge", async () => {
		expect(maxAge(edgeOf(await policy({})))).toBe(TTL.latest);
	});

	it("keeps a missing answer as briefly as a missing page", async () => {
		expect(maxAge(edgeOf(await policy({}, failed(404))))).toBe(TTL.missing);
	});

	it("leaves an answer that read the visitor, or a failure, to the framework's private no-store", async () => {
		expect(await policy({ perVisitor: true })).toBeNull();
		expect(await policy({}, failed(500))).toBeNull();
		expect(await policy({}, new Response("", { status: 500 }))).toBeNull();
	});

	it("knows a page from a remote call", () => {
		expect(remoteQuery(page("/[platform=platform]/[kind=kind]"))).toBeNull();
	});
});
