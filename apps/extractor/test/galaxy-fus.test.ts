import { afterEach, describe, expect, it, vi } from "vitest";
import { BurstRefusal, failureOf, permanent } from "../src/errors.ts";
import { FusError, FusHttpError, FusRefusal, FusSession, type Inform } from "../src/galaxy/fus.ts";
import { reaskDue } from "../src/galaxy/sales-codes.ts";
import { ranged } from "../src/galaxy/firmware.ts";

const fw = { model: "SM-X", region: "XAA", version: "A/B/C/D" };
const inform: Inform = {
	binaryName: "SM-X_1_20260101000000_abcdefghij_fac.zip.enc4",
	modelPath: "/neofus/1/",
	size: 32,
	displayName: "X",
	version: "A/B/C/D",
	logicValue: "0123456789abcdef",
	modelType: "",
	cscFile: "x",
};
const OK = "<FUSMsg><FUSBody><Results><Status>200</Status></Results></FUSBody></FUSMsg>";

/** FUS: each BinaryInitForMass hands out the next of `nonces`; a download signed with the first (lapsed) is refused. */
function fus(nonces: readonly string[]): { readonly inits: () => number } {
	let inits = 0;
	vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
		if (url.includes("BinaryInitForMass"))
			return new Response(OK, { headers: { nonce: nonces[Math.min(inits++, nonces.length - 1)] ?? "" } });
		const lapsed =
			new Headers(init?.headers).get("authorization")?.includes(`nonce="${nonces[0] ?? ""}"`) ?? true;
		return lapsed ? new Response(null, { status: 401 }) : new Response(new Uint8Array(4), { status: 206 });
	});
	return { inits: () => inits };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("FUS downloads", () => {
	it("renews a lapsed authorization once for every download refused with it", async () => {
		const server = fus(["AAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBB"]);
		const session = new FusSession();
		await session.initDownload(fw, inform);
		const bodies = await Promise.all([session.download(0, 16), session.download(16, 32)]);
		expect(
			await Promise.all(bodies.map(async (b) => (await new Response(b).arrayBuffer()).byteLength)),
		).toEqual([4, 4]);
		expect(server.inits()).toBe(2);
	});

	it("calls a 403 a burst refusal, and any other HTTP error final, each with the start of its body", async () => {
		const answering = async (status: number): Promise<unknown> => {
			vi.stubGlobal("fetch", async (): Promise<Response> => new Response("Access Denied", { status }));
			return new FusSession().inform(fw).catch((e: unknown) => e);
		};
		const blocked = await answering(403);
		expect(blocked).toBeInstanceOf(BurstRefusal);
		expect(String(blocked)).toMatch(/HTTP 403 .*: Access Denied$/);
		expect(failureOf(blocked)).toBe("burst");
		expect(permanent(blocked)).toBe(true);
		const refused = await answering(404);
		expect(refused).toBeInstanceOf(FusHttpError);
		expect(failureOf(refused)).toBe("permanent");
	});

	it("tells a firmware FUS does not serve (S01) from any other failed answer, and asks it again after 30 days", async () => {
		const informAnswering = async (status: string): Promise<unknown> => {
			vi.stubGlobal(
				"fetch",
				async (): Promise<Response> =>
					new Response(`<FUSMsg><FUSBody><Results><Status>${status}</Status></Results></FUSBody></FUSMsg>`, {
						headers: { nonce: "AAAAAAAAAAAAAAAA" },
					}),
			);
			return new FusSession().inform(fw).catch((e: unknown) => e);
		};
		expect(await informAnswering("S01")).toBeInstanceOf(FusRefusal);
		const other = await informAnswering("408");
		expect(other).toBeInstanceOf(FusError);
		expect(other).not.toBeInstanceOf(FusRefusal);
		expect(reaskDue("2026-09-08", "2026-10-07")).toBe(false);
		expect(reaskDue("2026-09-07", "2026-10-07")).toBe(true);
	});

	it("fails when the renewal brings no new nonce", async () => {
		fus(["AAAAAAAAAAAAAAAA"]);
		const session = new FusSession();
		await session.initDownload(fw, inform);
		await expect(session.download(0, 16)).rejects.toThrow(/no new nonce/);
	});
});

const refused = async (): Promise<ReadableStream<Uint8Array>> => {
	throw new Error("401");
};

describe("ranged", () => {
	it("resumes a body cut short at the byte it reached, and fails on any other error", async () => {
		vi.useFakeTimers();
		const file = Uint8Array.from({ length: 100 }, (_, i) => i);
		const asked: number[] = [];
		// The first connection drops after 30 bytes, as Node's fetch reports it.
		const download = async (start: number, end: number): Promise<ReadableStream<Uint8Array>> => {
			asked.push(start);
			const drop = asked.length === 1;
			let pulls = 0;
			return new ReadableStream({
				pull(c): void {
					if (pulls++ > 0) {
						if (drop) c.error(new TypeError("terminated"));
						else c.close();
					} else c.enqueue(file.slice(start, drop ? start + 30 : end));
				},
			});
		};
		const got: number[] = [];
		const reading = (async () => {
			for await (const chunk of ranged(download, 10, 100)) got.push(...chunk);
		})();
		await vi.runAllTimersAsync();
		await reading;
		vi.useRealTimers();
		expect(asked).toEqual([10, 40]);
		expect(got).toEqual(Array.from(file.subarray(10, 100)));
		await expect(
			(async () => {
				for await (const _ of ranged(refused, 0, 10)) continue;
			})(),
		).rejects.toThrow("401");
	});
});
