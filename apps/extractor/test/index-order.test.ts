// The index queue delivers messages in no promised order: two indexes fed the same records' messages in different orders
// (each in a fresh local D1 and bucket) end with the same rows.

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

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

const ATT: SourceKey<"ios"> = "ios:carrier:ATT_US";
const TMO: SourceKey<"ios"> = "ios:carrier:TMobile_US";
const VZW: SourceKey<"ios"> = "ios:carrier:Verizon_US";

const profile = (key: SourceKey<"ios">, sha: string, volte: "on" | "no"): Profile => ({
	schema: PROFILE_SCHEMA,
	source: { platform: "ios", kind: "carrier", name: key.split(":")[2] ?? "" },
	sha,
	identity: { display: key, iso: ["us"], sims: [{ mccmnc: `310${sha.length}${sha.at(-1) ?? ""}` }] },
	apns: [],
	concepts: { volte: { kind: "state", state: volte, because: [], fidelity: "exact" } },
	raw: { "carrier.plist:SupportsVoLTE": volte === "on" },
	variants: [],
});

const release = (
	id: string,
	version: string,
	released: string,
	sources: Record<SourceKey<"ios">, readonly [sha: string, version: string]>,
): AppleRelease => ({
	platform: "ios",
	id,
	version,
	label: version,
	prerelease: false,
	released,
	devices: ["iPhone18,1"],
	extractedAt: "2026-10-05T00:00:00Z",
	sources: Object.fromEntries(
		Object.entries(sources).map(([key, [sha, ver]]) => [key, { sha, version: ver, size: 1, cid: sha }]),
	),
	modems: [],
});

const RELEASES = [
	release("24A100", "27.0", "2026-09-15", { [ATT]: ["att1", "70.0"], [TMO]: ["tmo1", "60.0"] }),
	release("24B200", "27.1", "2026-10-20", {
		[ATT]: ["att2", "71.0"],
		[TMO]: ["tmo1", "60.0"],
		[VZW]: ["vzw1", "50.0"],
	}),
	release("24C300", "27.2", "2026-11-20", { [ATT]: ["att2", "71.0"], [VZW]: ["vzw2", "51.0"] }),
];
const PROFILES = [
	profile(ATT, "att1", "no"),
	profile(ATT, "att2", "on"),
	profile(TMO, "tmo1", "on"),
	profile(VZW, "vzw1", "no"),
	profile(VZW, "vzw2", "on"),
];

const proxies: Array<Awaited<ReturnType<typeof getPlatformProxy>>> = [];
afterAll(() => Promise.all(proxies.map((p) => p.dispose())));

/** Every row of every table, in a stable order. */
async function dump(d1: D1Database): Promise<Record<string, string[]>> {
	const tables = await d1
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
		)
		.all<{ name: string }>();
	const rows = async (name: string): Promise<string[]> =>
		(await d1.prepare(`SELECT * FROM "${name}"`).all()).results.map((r) => JSON.stringify(r)).toSorted();
	return Object.fromEntries(
		await Promise.all(tables.results.map(async ({ name }) => [name, await rows(name)] as const)),
	);
}

/**
 * A fresh index fed the releases' messages, taking each next from the queue as `pick` chooses; what a message hands on
 * joins the queue. Returns its rows.
 */
async function indexed(
	order: readonly number[],
	pick: (queued: readonly IndexMessage[]) => number,
): Promise<Record<string, string[]>> {
	const proxy = await getPlatformProxy<{ DB: D1Database; BUCKET: R2Bucket }>({
		configPath: join(import.meta.dirname, "wrangler.jsonc"),
		persist: false,
	});
	proxies.push(proxy);
	const { DB: d1, BUCKET: bucket } = proxy.env;
	for (const m of readdirSync(MIGRATIONS).toSorted()) {
		const statements = readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8")
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean);
		await d1.batch(statements.map((s) => d1.prepare(s)));
	}
	const db = indexDb(d1);
	await syncDevices(db, [{ code: "iPhone18,1", platform: "ios", released: "2025-09-19", boards: ["V53AP"] }]);
	for (const p of PROFILES) await putJson(bucket, keys.norm(p.sha), p);
	for (const r of RELEASES) await putJson(bucket, keys.release("ios", r.id), r);

	const queued: IndexMessage[] = order.map((i): IndexMessage => ({
		kind: "release",
		release: { platform: "ios", id: [RELEASES[i]?.id ?? ""] },
	}));
	while (queued.length > 0) {
		const [m] = queued.splice(pick(queued), 1);
		if (m === undefined) throw new Error("no message");
		const done = await indexUnit({ db, bucket }, m);
		if (done.next !== null) queued.push(done.next);
	}
	return dump(d1);
}

describe("the index queue's messages", () => {
	// Each of the three runs boots its own workerd, which takes seconds on a loaded machine.
	it("leave the same rows whatever order they are consumed in", async () => {
		const inOrder = await indexed([0, 1, 2], () => 0);
		expect(inOrder.entries?.length).toBeGreaterThan(0);
		expect(inOrder.changes?.length).toBeGreaterThan(0);
		// Newest release first, and each message's hand-on taken before anything queued earlier.
		expect(await indexed([2, 1, 0], (queued) => queued.length - 1)).toEqual(inOrder);
		// Oldest first again, but every release's facts before any source is derived.
		expect(
			await indexed([1, 0, 2], (queued) =>
				Math.max(
					0,
					queued.findIndex((m) => m.kind === "release"),
				),
			),
		).toEqual(inOrder);
	}, 120_000);
});
