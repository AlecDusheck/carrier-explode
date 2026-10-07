// streamRange: a long range read that resumes where a connection broke.

import { describe, expect, it } from "vitest";

import { streamRange } from "../src/range-stream.ts";

const DATA = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);

type Ending = "reset" | "short";

/** Serves DATA honouring Range; the first `breaks` bodies stop after `cut` bytes, by a reset or by ending early. */
function server(
	breaks: number,
	cut = 300,
	ending: Ending = "reset",
): { fetch: typeof fetch; ranges: string[] } {
	const ranges: string[] = [];
	let left = breaks;
	const fake = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const range = new Headers(init?.headers).get("range") ?? "";
		ranges.push(range);
		const [, start = 0, end = 0] = (/^bytes=(\d+)-(\d+)$/.exec(range) ?? []).map(Number);
		const body = DATA.slice(start, end + 1);
		const failing = left-- > 0;
		// Pull-driven, so a chunk is read before the error that follows it (an error discards queued chunks).
		const parts = failing ? [body.slice(0, cut)] : [body.slice(0, 100), new Uint8Array(0), body.slice(100)];
		const stream = new ReadableStream<Uint8Array>({
			pull(c) {
				const next = parts.shift();
				if (next) c.enqueue(next);
				else if (failing && ending === "reset") c.error(new Error("connection reset"));
				else c.close();
			},
		});
		return new Response(stream, {
			status: 206,
			headers: { "content-range": `bytes ${start}-${end}/${DATA.length}` },
		});
	};
	return { fetch: fake, ranges };
}

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	for await (const p of chunks) parts.push(p);
	return new Uint8Array(Buffer.concat(parts));
}

describe("streamRange", () => {
	it("streams exactly the range, past empty chunks", async () => {
		const s = server(0);
		expect(await collect(streamRange("https://x/f", 10, 500, { fetch: s.fetch }))).toEqual(
			DATA.slice(10, 510),
		);
		expect(s.ranges).toEqual(["bytes=10-509"]);
	});

	it.each(["reset", "short"] as const)("resumes where a body that %s left off", async (ending) => {
		const s = server(2, 300, ending);
		expect(await collect(streamRange("https://x/f", 0, 1000, { fetch: s.fetch, backoff: 0 }))).toEqual(DATA);
		expect(s.ranges).toEqual(["bytes=0-999", "bytes=300-999", "bytes=600-999"]);
	});

	it("gives up after repeated failures without progress", async () => {
		const s = server(10, 0);
		await expect(
			collect(streamRange("https://x/f", 0, 1000, { fetch: s.fetch, backoff: 0, tries: 3 })),
		).rejects.toThrow(/connection reset/);
		expect(s.ranges).toHaveLength(3);
	});

	it("refuses a server that ignores Range", async () => {
		const fake = async (): Promise<Response> => new Response(DATA, { status: 200 });
		await expect(collect(streamRange("https://x/f", 0, 10, { fetch: fake }))).rejects.toThrow(/got HTTP 200/);
	});
});
