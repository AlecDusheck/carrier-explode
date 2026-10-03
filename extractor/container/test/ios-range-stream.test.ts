// streamRange (../src/jobs/ios/range-stream.ts): a long range read that resumes where a connection broke.

import { afterEach, describe, expect, it, vi } from "vitest";

import { streamRange } from "../src/jobs/ios/range-stream.ts";

const DATA = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);

/** A server for DATA that honours Range, and cuts the first `breaks` bodies off after `cut` bytes. */
function server(breaks: number, cut = 300): { fetch: typeof fetch; ranges: string[] } {
  const ranges: string[] = [];
  let left = breaks;
  const fake = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const range = new Headers(init?.headers).get("range") ?? "";
    ranges.push(range);
    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(m?.[1]);
    const end = Number(m?.[2]);
    const body = DATA.slice(start, end + 1);
    const failing = left-- > 0;
    // Pull-driven, so a chunk is read before the error that follows it (an error discards queued chunks).
    const parts = failing ? [body.slice(0, cut)] : [body.slice(0, 100), body.slice(100)];
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        const next = parts.shift();
        if (next) c.enqueue(next);
        else if (failing) c.error(new Error("connection reset"));
        else c.close();
      },
    });
    return new Response(stream, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${DATA.length}` } });
  };
  return { fetch: fake, ranges };
}

async function collect(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const p of it) parts.push(p);
  return new Uint8Array(Buffer.concat(parts));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamRange", () => {
  it("streams exactly the range", async () => {
    const s = server(0);
    vi.stubGlobal("fetch", s.fetch);
    expect(await collect(streamRange("https://x/f", 10, 500))).toEqual(DATA.slice(10, 510));
    expect(s.ranges).toEqual(["bytes=10-509"]);
  });

  it("resumes from where a dropped connection left off", async () => {
    const s = server(2);
    vi.stubGlobal("fetch", s.fetch);
    expect(await collect(streamRange("https://x/f", 0, 1000, { backoffMs: 0 }))).toEqual(DATA);
    expect(s.ranges).toEqual(["bytes=0-999", "bytes=300-999", "bytes=600-999"]);
  });

  it("gives up after repeated failures without progress", async () => {
    vi.stubGlobal("fetch", server(10, 0).fetch);
    await expect(collect(streamRange("https://x/f", 0, 1000, { backoffMs: 0 }))).rejects.toThrow(/connection reset/);
  });

  it("refuses a server that ignores Range", async () => {
    vi.stubGlobal("fetch", async () => new Response(DATA, { status: 200 }));
    await expect(collect(streamRange("https://x/f", 0, 10))).rejects.toThrow(/got HTTP 200/);
  });
});
