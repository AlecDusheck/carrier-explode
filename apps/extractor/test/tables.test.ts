import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { type NormArtifact, normBatches } from "../src/normalize.ts";
import { instanceId, iosRun, pipelineOfInstance, reindexRun, runOf } from "../src/runs.ts";
import { FEED_NAMES, PIPELINE_NAMES, type PipelineParams, PIPELINES } from "../src/pipelines.ts";
import { QUEUES } from "../src/queues.ts";
import { tuningSchema } from "../src/env.ts";
import { readers, wrangler } from "./wrangler.ts";

/** What a queue carries, by its name. */
const role = (queue: string): string | undefined =>
	Object.entries(QUEUES).find(([named]) => named === queue)?.[1];

const sha = (i: number): string => i.toString(16).padStart(64, "0");

describe("ids", () => {
	it("names an instance by its unit, in the characters Workflows accept", () => {
		expect(instanceId("pixel-device", "CP3A.260905.009-tokay")).toBe("pixel-device-CP3A_260905_009-tokay");
		expect(() => instanceId("ios-build", "x".repeat(100))).toThrow(/too long/);
	});

	it("reads the pipeline back from an instance id", () => {
		expect(pipelineOfInstance("apple-ota-0123")).toBe("apple-ota");
		expect(pipelineOfInstance("nope-1")).toBeUndefined();
	});

	it("names a planned unit by its build and device alone, so a check never starts it twice", () => {
		const params = {
			build: "CP3A.260905.009",
			version: "17",
			patch: "2026-09",
			device: "tokay",
			url: "https://dl.google.com/t.zip",
		};
		expect(runOf({ pipeline: "pixel-device", params }).id).toBe("pixel-device-CP3A_260905_009-tokay");
	});

	it("names an iOS build by the phones its record holds, so a build has one live instance however its IPSWs change", () => {
		const build = { build: "24A446", version: "27.0", label: "27.0", prerelease: false };
		const one = { ...build, ipsws: [{ device: "iPhone18,1", url: "https://u/a" }] };
		const two = { ...build, ipsws: [...one.ipsws, { device: "iPhone18,3", url: "https://u/b" }] };
		// A phone listed while the first instance runs: the same unit, so the check counts it live and starts nothing.
		expect(iosRun(two, undefined).id).toBe(iosRun(one, undefined).id);
		expect(iosRun(one, undefined).id).toBe("ios-build-24A446");
		// Once its record holds one phone, a phone it lacks plans it again, under a new id.
		const held = iosRun(two, new Set(["iPhone18,1"])).id;
		expect(held).toMatch(/^ios-build-24A446-[0-9a-f]{8}$/);
		expect(iosRun(two, new Set(["iPhone18,1", "iPhone18,3"])).id).not.toBe(held);
		expect(iosRun(one, new Set(["iPhone18,1"])).id).toBe(held);
	});

	it("names a reindex by its target and the second it was asked for, so the same target reindexes again", async () => {
		const release: PipelineParams<"reindex"> = {
			target: { kind: "release", release: { platform: "android", id: ["CP3A.260905.009", "tokay"] } },
		};
		expect((await reindexRun(release, new Date("2026-10-05T21:55:01.250Z"))).id).toBe(
			"reindex-android-CP3A_260905_009-tokay-20261005215501",
		);
		expect((await reindexRun(release, new Date("2026-10-05T22:10:00Z"))).id).toBe(
			"reindex-android-CP3A_260905_009-tokay-20261005221000",
		);
	});

	it("names a reindex of an OTA file by its record's key, within the id limit", async () => {
		const file = await reindexRun(
			{
				target: { kind: "ota", feed: "apple", url: `https://updates.cdn-apple.com/${"x".repeat(200)}.ipcc` },
			},
			new Date("2026-10-05T21:55:01Z"),
		);
		expect(file.id).toMatch(/^reindex-apple-[0-9a-f]{64}-20261005215501$/);
	});
});

/** Worker and Workflow names are account-wide: each environment's are its own. */
const named = (env: "dev" | "production", name: string): string =>
	`carrier-explode-${name}${env === "dev" ? "-dev" : ""}`;

describe.each(["dev", "production"] as const)("wrangler.jsonc's %s environment", (name) => {
	const env = wrangler.env[name];
	const tuning = v.parse(tuningSchema, env.vars);

	it("names the Worker and its Workflows for the environment", () => {
		expect(env.name).toBe(named(name, "extractor"));
		expect(env.workflows.map((w) => w.name)).toEqual(
			env.workflows.map((w) =>
				named(name, PIPELINE_NAMES.find((p) => PIPELINES[p].binding === w.binding) ?? w.binding),
			),
		);
	});

	it("binds one Workflow per pipeline (labels only with the AI binding and LABELLER), and the container's Durable Object", () => {
		const labelling = env.ai !== undefined;
		expect(tuning.LABELLER !== undefined).toBe(labelling);
		const bound = PIPELINE_NAMES.filter((p) => labelling || p !== "labels");
		expect(env.workflows.map((w) => w.binding).toSorted()).toEqual(
			bound.map((p) => PIPELINES[p].binding).toSorted(),
		);
		expect(env.durable_objects.bindings.map((b) => b.name).toSorted()).toEqual(["EXTRACTOR"]);
	});

	it("produces to and consumes the index queue and the purge queue, each one batch at a time", () => {
		const { producers, consumers } = env.queues;
		expect(producers.map((p) => [p.binding, role(p.queue)]).toSorted()).toEqual([
			["INDEX_QUEUE", "index"],
			["PURGE_QUEUE", "purge"],
		]);
		expect(consumers.map((c) => c.queue).toSorted()).toEqual(producers.map((p) => p.queue).toSorted());
		const index = consumers.find((c) => role(c.queue) === "index");
		const purge = consumers.find((c) => role(c.queue) === "purge");
		expect([index?.max_batch_size, index?.max_concurrency, purge?.max_concurrency]).toEqual([1, 1, 1]);
	});

	it("shares all but one of the container class's max_instances among the pipelines that hold one", () => {
		expect(Object.values(tuning.CONTAINER_SHARE).reduce((a, b) => a + b, 0) + 1).toBe(
			env.containers[0].max_instances,
		);
	});
});

describe("wrangler.jsonc's environments", () => {
	it("has the site and the API read in dev the index and bucket the extractor writes", () => {
		const { d1_databases, r2_buckets } = wrangler.env.dev;
		for (const reader of Object.values(readers))
			expect([reader.env.dev.d1_databases, reader.env.dev.r2_buckets]).toEqual([d1_databases, r2_buckets]);
	});

	it("names the site and the API for each environment", () => {
		for (const [app, reader] of Object.entries(readers)) {
			expect([reader.env.dev.name, reader.env.production.name]).toEqual([
				named("dev", app),
				named("production", app),
			]);
		}
	});

	it("schedules only the feeds' crons in production, and none in dev", () => {
		const feedCrons = new Set<string>(FEED_NAMES.map((f) => PIPELINES[f].cron));
		expect(wrangler.env.production.triggers.crons.filter((c) => !feedCrons.has(c))).toEqual([]);
		expect(wrangler.env.dev.triggers.crons).toEqual([]);
	});
});

describe("the normalize table", () => {
	it("cuts a pending list into steps: up to each kind's perStep, never mixing kinds", () => {
		const settings = Array.from({ length: 250 }, (_, i): NormArtifact => ({
			kind: "android.carrier-settings",
			sha: sha(i),
			source: "android:carrier:x",
		}));
		const configs = Array.from({ length: 12 }, (_, i): NormArtifact => ({
			kind: "android.modem-config",
			sha: sha(1000 + i),
			source: null,
		}));
		expect(normBatches([...settings, ...configs])).toEqual([
			[0, 100],
			[100, 200],
			[200, 250],
			[250, 260],
			[260, 262],
		]);
		expect(normBatches([])).toEqual([]);
	});
});
