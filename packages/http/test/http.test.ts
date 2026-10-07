/** http against a scripted fetch. */

import { describe, expect, it } from "vitest";
import {
	fetchApple,
	fetchRange,
	fetchWithRetry,
	HttpError,
	isAppleHost,
	RangeResponseError,
} from "../src/index.ts";

/** A fetch answering from a list, recording each request's URL and cache mode. */
function scripted(...answers: Array<Response | Error>): {
	fetch: typeof fetch;
	urls: string[];
	caches: unknown[];
} {
	const urls: string[] = [];
	const caches: unknown[] = [];
	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		urls.push(String(input));
		// Node's RequestInit types no cache mode; Workers' and browsers' do.
		caches.push(init !== undefined && "cache" in init ? init.cache : undefined);
		const next = answers.shift();
		if (!next) throw new Error("unexpected request");
		if (next instanceof Error) throw next;
		return next;
	};
	return { fetch, urls, caches };
}

describe("fetchWithRetry", () => {
	it("retries 5xx, 429 and network errors", async () => {
		const s = scripted(
			new Response(null, { status: 503 }),
			new TypeError("reset"),
			new Response(null, { status: 429 }),
			new Response("ok"),
		);
		const res = await fetchWithRetry("https://h.test/x", {}, { fetch: s.fetch, backoff: 0 });
		expect(await res.text()).toBe("ok");
		expect(s.urls.length).toBe(4);
	});

	it("gives up at once on 404 and after `tries` on 5xx", async () => {
		await expect(
			fetchWithRetry(
				"https://h.test/x",
				{},
				{ ...scripted(new Response(null, { status: 404 })), backoff: 0 },
			),
		).rejects.toMatchObject({ status: 404 });
		const s = scripted(new Response(null, { status: 500 }), new Response(null, { status: 502 }));
		await expect(
			fetchWithRetry("https://h.test/x", {}, { fetch: s.fetch, tries: 2, backoff: 0 }),
		).rejects.toThrow(HttpError);
	});

	it("stops waiting out a backoff when the caller aborts", async () => {
		const s = scripted(new Response(null, { status: 503 }));
		const abort = new AbortController();
		const pending = fetchWithRetry(
			"https://h.test/x",
			{ signal: abort.signal },
			{ fetch: s.fetch, backoff: 60_000 },
		);
		setTimeout(() => abort.abort(new Error("cancelled")), 10);
		await expect(pending).rejects.toThrow("cancelled");
		expect(s.urls.length).toBe(1);
	});

	it("abandons an attempt that outlives its timeout, and retries it", async () => {
		let calls = 0;
		const fetch = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
			calls++;
			if (calls > 1) return Promise.resolve(new Response("ok"));
			return new Promise((_resolve, reject) =>
				init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
			);
		};
		const res = await fetchWithRetry("https://h.test/x", {}, { fetch, timeout: 10, backoff: 0 });
		expect(await res.text()).toBe("ok");
		expect(calls).toBe(2);
	});
});

const ranged = (body: string, range: string): Response =>
	new Response(body, { status: 206, headers: { "content-range": range } });

describe("fetchRange", () => {
	it("returns exactly the asked bytes", async () => {
		const s = scripted(ranged("cde", "bytes 2-4/10"));
		expect(new TextDecoder().decode(await fetchRange("https://h.test/x", 2, 4, { fetch: s.fetch }))).toBe(
			"cde",
		);
	});

	it("bypasses the subrequest cache, which would answer with the whole file", async () => {
		const s = scripted(ranged("cde", "bytes 2-4/10"), new Response("x"));
		await fetchRange("https://h.test/x", 2, 4, { fetch: s.fetch });
		await fetchWithRetry("https://h.test/x", {}, { fetch: s.fetch });
		expect(s.caches).toEqual(["no-store", undefined]);
	});

	it("retries a body cut short, within the same budget", async () => {
		const cut = new ReadableStream<Uint8Array>({ start: (c) => c.error(new TypeError("terminated")) });
		const s = scripted(
			new Response(cut, { status: 206, headers: { "content-range": "bytes 2-4/10" } }),
			ranged("cde", "bytes 2-4/10"),
		);
		expect(
			new TextDecoder().decode(await fetchRange("https://h.test/x", 2, 4, { fetch: s.fetch, backoff: 0 })),
		).toBe("cde");
		expect(s.urls.length).toBe(2);
	});

	it("rejects a 200, a different range, or a short body", async () => {
		for (const res of [
			new Response("abcdefghij"),
			ranged("cd", "bytes 2-3/10"),
			ranged("cd", "bytes 2-4/10"),
		]) {
			await expect(fetchRange("https://h.test/x", 2, 4, { ...scripted(res), backoff: 0 })).rejects.toThrow(
				RangeResponseError,
			);
		}
	});
});

describe("Apple hosts", () => {
	it("allows Apple's download hosts only", () => {
		for (const h of [
			"updates.cdn-apple.com",
			"appldnld.apple.com",
			"appldnld.apple.com.edgesuite.net",
			"apple.com",
		])
			expect(isAppleHost(h), h).toBe(true);
		for (const h of ["apple.com.evil.test", "notapple.com", "cdn-apple.com.test"])
			expect(isAppleHost(h), h).toBe(false);
	});

	it("refuses another host and falls back to the other scheme on Apple's", async () => {
		await expect(fetchApple("https://h.test/a")).rejects.toThrow(/not an Apple host/);
		const s = scripted(new Response(null, { status: 404 }), new Response("ipcc"));
		const got = await fetchApple("http://appldnld.apple.com/a.ipcc", {}, { fetch: s.fetch, backoff: 0 });
		expect(new TextDecoder().decode(got)).toBe("ipcc");
		expect(s.urls).toEqual(["http://appldnld.apple.com/a.ipcc", "https://appldnld.apple.com/a.ipcc"]);
	});

	it("does not fall back after an abort", async () => {
		const abort = new DOMException("stop", "AbortError");
		const s = scripted(abort);
		await expect(fetchApple("https://appldnld.apple.com/a", {}, { fetch: s.fetch, tries: 1 })).rejects.toBe(
			abort,
		);
		expect(s.urls).toEqual(["https://appldnld.apple.com/a"]);
	});

	it("reports both failures", async () => {
		const s = scripted(new Response(null, { status: 404 }), new Response(null, { status: 404 }));
		await expect(fetchApple("https://appldnld.apple.com/a", {}, { fetch: s.fetch })).rejects.toThrow(
			AggregateError,
		);
	});
});
