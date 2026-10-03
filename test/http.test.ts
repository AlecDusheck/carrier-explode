/** src/lib/http against a scripted fetch. */

import { describe, expect, it } from "vitest";
import { contentLength, fetchRange, fetchWithRetry, HttpError, RangeResponseError, withSchemeFallback } from "../src/lib/http/index.ts";

/** A fetch answering from a list, recording each request's URL. */
function scripted(...answers: Array<Response | Error>): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    urls.push(String(input));
    const next = answers.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, urls };
}

describe("fetchWithRetry", () => {
  it("retries 5xx, 429 and network errors", async () => {
    const s = scripted(new Response(null, { status: 503 }), new TypeError("reset"), new Response(null, { status: 429 }), new Response("ok"));
    const res = await fetchWithRetry("https://h.test/x", {}, { fetch: s.fetch, backoff: 0 });
    expect(await res.text()).toBe("ok");
    expect(s.urls.length).toBe(4);
  });

  it("gives up at once on 404 and after `tries` on 5xx", async () => {
    await expect(fetchWithRetry("https://h.test/x", {}, { ...scripted(new Response(null, { status: 404 })), backoff: 0 })).rejects.toMatchObject({ status: 404 });
    const s = scripted(new Response(null, { status: 500 }), new Response(null, { status: 502 }));
    await expect(fetchWithRetry("https://h.test/x", {}, { fetch: s.fetch, tries: 2, backoff: 0 })).rejects.toThrow(HttpError);
  });
});

describe("fetchRange", () => {
  const ranged = (body: string, range: string): Response => new Response(body, { status: 206, headers: { "content-range": range } });

  it("returns exactly the asked bytes", async () => {
    const s = scripted(ranged("cde", "bytes 2-4/10"));
    expect(new TextDecoder().decode(await fetchRange("https://h.test/x", 2, 4, { fetch: s.fetch }))).toBe("cde");
  });

  it("rejects a 200, a different range, or a short body", async () => {
    for (const res of [new Response("abcdefghij"), ranged("cd", "bytes 2-3/10"), ranged("cd", "bytes 2-4/10")]) {
      await expect(fetchRange("https://h.test/x", 2, 4, { ...scripted(res), backoff: 0 })).rejects.toThrow(RangeResponseError);
    }
  });
});

describe("contentLength", () => {
  it("reads Content-Length from HEAD", async () => {
    expect(await contentLength("https://h.test/x", scripted(new Response(null, { headers: { "content-length": "1234" } })))).toBe(1234);
  });
});

describe("withSchemeFallback", () => {
  it("tries the other scheme when the first fails", async () => {
    const seen: string[] = [];
    const got = await withSchemeFallback("http://h.test/a", async (u) => {
      seen.push(u.protocol);
      if (u.protocol === "http:") throw new HttpError(String(u), 404);
      return "ok";
    });
    expect(got).toBe("ok");
    expect(seen).toEqual(["http:", "https:"]);
  });

  it("reports both failures", async () => {
    await expect(withSchemeFallback("https://h.test/a", async () => { throw new Error("down"); })).rejects.toThrow(AggregateError);
  });
});
