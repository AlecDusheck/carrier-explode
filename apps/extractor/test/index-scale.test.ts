// A first-time iOS build's indexing, at a real build's size (900 sources, some heads of thousands of leaves): every
// message keeps within the 1,000 D1 queries one Worker invocation may make, each statement of a batch counted.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterAll, describe, expect, it } from "vitest";

import { indexDb, syncDevices } from "@carrier-explode/db";
import {
	PROFILE_SCHEMA,
	type AppleRelease,
	type Profile,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { keys, putJson } from "@carrier-explode/storage";
import { type IndexMessage, indexUnit } from "../src/indexing.ts";
import { productionTuning } from "./wrangler.ts";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const SOURCES = 900;
/** D1's queries per Worker invocation on Workers Paid. */
const QUERIES = 1000;

const proxy = await getPlatformProxy<{ DB: D1Database; BUCKET: R2Bucket }>({
	configPath: join(import.meta.dirname, "wrangler.jsonc"),
	persist: false,
});
afterAll(() => proxy.dispose());

/** The database, counting the statements prepared: one per query, and one per statement of a batch. */
function counting(d1: D1Database): { readonly db: D1Database; readonly take: () => number } {
	let n = 0;
	const db = new Proxy(d1, {
		get: (target, p) => {
			if (p === "prepare")
				return (query: string) => {
					n++;
					return target.prepare(query);
				};
			const value: unknown = Reflect.get(target, p);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return {
		db,
		take: () => {
			const was = n;
			n = 0;
			return was;
		},
	};
}

const sourceOf = (i: number): SourceKey<"ios"> => `ios:carrier:Carrier${String(i).padStart(4, "0")}_US`;

/** Every tenth head is as big as Verizon's (9,075 leaves), the rest as AT&T's of 2009 (70). */
const profileOf = (i: number): Profile => ({
	schema: PROFILE_SCHEMA,
	source: { platform: "ios", kind: "carrier", name: sourceOf(i).split(":")[2] ?? "" },
	sha: `sha${i}`,
	identity: { display: `Carrier ${i}`, iso: ["us"], sims: [{ mccmnc: `310${String(i).padStart(3, "0")}` }] },
	apns: [],
	concepts: { volte: { kind: "state", state: i % 2 ? "on" : "no", because: [], fidelity: "exact" } },
	raw: Object.fromEntries(
		Array.from({ length: i % 10 ? 70 : 9075 }, (_, k) => [
			`overrides_N${k % 40}.plist:Apns[${k}].Name`,
			`apn ${"x".repeat(100)} ${k}`,
		]),
	),
	variants: [],
});

describe("a first-time iOS build of 900 sources", () => {
	it("is indexed in messages of at most 1,000 D1 queries each", async () => {
		const { DB: d1, BUCKET: bucket } = proxy.env;
		for (const m of readdirSync(MIGRATIONS).toSorted()) {
			const statements = readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8")
				.split("--> statement-breakpoint")
				.map((s) => s.trim())
				.filter(Boolean);
			await d1.batch(statements.map((s) => d1.prepare(s)));
		}
		await syncDevices(indexDb(d1), [
			{ code: "iPhone18,1", platform: "ios", released: "2025-09-19", boards: ["V53AP"] },
		]);
		const release: AppleRelease = {
			platform: "ios",
			id: "24A100",
			version: "27.0",
			label: "27.0",
			prerelease: false,
			released: "2026-09-15",
			devices: ["iPhone18,1"],
			extractedAt: "2026-10-05T00:00:00Z",
			sources: Object.fromEntries(
				Array.from({ length: SOURCES }, (_, i) => [
					sourceOf(i),
					{ sha: `sha${i}`, version: "1.0", size: 1, cid: `sha${i}` },
				]),
			),
			modems: [],
		};
		for (let i = 0; i < SOURCES; i++) await putJson(bucket, keys.profile(`sha${i}`), profileOf(i));
		await putJson(bucket, keys.release("ios", release.id), release);

		const counted = counting(d1);
		const ctx = { db: indexDb(counted.db), bucket, batch: productionTuning.INDEX_BATCH };
		const perMessage: Array<readonly [string, number]> = [];
		for (
			let m: IndexMessage | null = { kind: "release", release: { platform: "ios", id: [release.id] } };
			m !== null;
		) {
			const done = await indexUnit(ctx, m);
			perMessage.push([m.kind, counted.take()]);
			m = done.next;
		}
		const most = Math.max(...perMessage.map(([, n]) => n));
		// The facts in two messages (the profiles are ~100 MB), the settle and rederive messages, then the sources 25 a message.
		expect(perMessage.map(([kind]) => kind).slice(0, 4)).toEqual([
			"release",
			"release",
			"settle",
			"rederive",
		]);
		expect(perMessage.length).toBe(4 + Math.ceil(SOURCES / 25));
		expect(most).toBeLessThanOrEqual(QUERIES);
		expect(await d1.prepare("SELECT count(*) AS n FROM sources").first("n")).toBe(SOURCES);
		expect(await d1.prepare("SELECT count(*) AS n FROM settings").first("n")).toBe(810 * 70 + 90 * 9075);
	}, 600_000);
});
