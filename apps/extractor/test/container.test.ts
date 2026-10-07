// A container job's deadline and its container's lifetime (../src/container.ts), and one container per attempt (../src/unit.ts).

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContainerJob } from "../src/container-protocol.ts";

vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: Object }));
vi.mock("cloudflare:workflows", () => ({ NonRetryableError: class extends Error {} }));
vi.mock("@cloudflare/containers", () => ({ Container: Object }));

const { Extractor, JOB_DEADLINE_MS, SLEEP_AFTER } = await import("../src/container.ts");
const { containerName } = await import("../src/unit.ts");

const job: ContainerJob = { job: "galaxy.ap", params: {} };

/** A container whose job server takes `answer` to reply, recording what was asked of it. */
function fakeContainer(answer: (signal: AbortSignal | null | undefined) => Promise<Response>) {
	const calls: string[] = [];
	return {
		calls,
		startAndWaitForPorts: async () => {
			calls.push("start");
		},
		containerFetch: (_url: string, init: RequestInit) => {
			calls.push("fetch");
			return answer(init.signal);
		},
		destroy: async () => {
			calls.push("destroy");
		},
	};
}

describe("a container", () => {
	it("stops once idle, whether or not the object that started it still holds the job's deadline", () => {
		// The base class is mocked, so the object takes no state or env.
		const container: { readonly sleepAfter: unknown } = Reflect.construct(Extractor, []);
		expect(container.sleepAfter).toBe(SLEEP_AFTER);
	});
});

describe("a container job", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("that never answers is abandoned at its deadline, and its container destroyed", async () => {
		vi.useFakeTimers();
		let aborted = false;
		const c = fakeContainer(
			(signal) =>
				new Promise<Response>(() => {
					signal?.addEventListener("abort", () => {
						aborted = true;
					});
				}),
		);
		const run = Extractor.prototype.run.call(c, job);
		const settled = run.then(
			() => "answered",
			(e: unknown) => (e instanceof Error ? e.message : String(e)),
		);
		await vi.advanceTimersByTimeAsync(JOB_DEADLINE_MS - 1);
		expect(c.calls).toEqual(["start", "fetch"]);
		await vi.advanceTimersByTimeAsync(1);
		expect(await settled).toMatch(/no answer within/);
		expect(aborted).toBe(true);
		expect(c.calls).toEqual(["start", "fetch", "destroy"]);
	});

	it("that answers destroys its container too", async () => {
		const c = fakeContainer(async () => Response.json({ ok: true, output: { n: 1 } }));
		expect(await Extractor.prototype.run.call(c, job)).toEqual({ ok: true, output: '{"n":1}' });
		expect(c.calls).toEqual(["start", "fetch", "destroy"]);
	});
});

describe("a container step", () => {
	it("runs each attempt in a container of its own", () => {
		const names = [1, 2, 3].map((attempt) => containerName("galaxy-build-S942U", "ap", attempt));
		expect(new Set(names).size).toBe(3);
	});
});
