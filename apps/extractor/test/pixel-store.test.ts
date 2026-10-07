// R2 puts a Pixel's CarrierSettings directory costs (../src/pixel/device.ts storeSettingsDir): every file the
// first time, and only what the index does not hold after that.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { indexDb, putProfiles, type IndexDb } from "@carrier-explode/db";
import type { DirEntry, Filesystem } from "@carrier-explode/firmware";
import { profileFacts } from "@carrier-explode/schema";
import { profileSchema } from "@carrier-explode/schema/records";
import { keys } from "@carrier-explode/storage";
import * as v from "valibot";
import { normWriter, storeNormalized } from "../src/normalize.ts";
import { storeSettingsDir } from "../src/pixel/device.ts";

const proxy = await getPlatformProxy<{ DB: D1Database; BUCKET: R2Bucket }>({
	configPath: join(import.meta.dirname, "wrangler.jsonc"),
	persist: false,
});
const { DB: d1, BUCKET: r2 } = proxy.env;
let db: IndexDb;

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const FIXTURES = join(
	import.meta.dirname,
	"../../../packages/firmware/test/fixtures/android/tree/etc/CarrierSettings",
);
const DIR = "etc/CarrierSettings";

/** The bucket, counting its puts: each is a Class A operation, whether or not it writes. */
function counting(bucket: R2Bucket): { readonly bucket: R2Bucket; puts: () => number } {
	let n = 0;
	const counted = new Proxy(bucket, {
		get(target, prop) {
			if (prop !== "put") return Reflect.get(target, prop, target);
			return (...args: Parameters<R2Bucket["put"]>) => {
				n++;
				return target.put(...args);
			};
		},
	});
	return { bucket: counted, puts: () => n };
}

/** A CarrierSettings directory in memory: the fixture files, and a carrier list. */
function directory(files: ReadonlyMap<string, Uint8Array>): Filesystem {
	const entries: DirEntry[] = [...files.keys()].map((name, inode) => ({ name, inode, kind: "file" }));
	const read = async (path: string): Promise<Uint8Array> => {
		const bytes = files.get(path.slice(DIR.length + 1));
		if (bytes === undefined) throw new Error(`${path}: no such file`);
		return bytes;
	};
	return {
		kind: "erofs",
		readdir: async () => entries,
		readFile: read,
		readStream: (path) => ({
			async *[Symbol.asyncIterator]() {
				yield await read(path);
			},
		}),
		readlink: async (path) => {
			throw new Error(`${path}: not a symlink`);
		},
	};
}

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** What the index step does with a device's record, as far as storing goes: a profiles row per sha it names. */
async function indexed(shas: readonly string[]): Promise<void> {
	await putProfiles(
		db,
		await Promise.all(
			shas.map(async (sha) => {
				const o = await r2.get(keys.norm(sha));
				if (o === null) throw new Error(`${sha}: not stored`);
				return profileFacts(v.parse(profileSchema, await o.json()));
			}),
		),
	);
}

beforeAll(async () => {
	for (const m of readdirSync(MIGRATIONS).toSorted()) {
		const statements = readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8")
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean);
		await d1.batch(statements.map((s) => d1.prepare(s)));
	}
	db = indexDb(d1);
});

afterAll(() => proxy.dispose());

describe("a Pixel's CarrierSettings, stored", () => {
	const files = new Map([
		["spektrummso_us.pb", fixture("spektrummso_us.pb")],
		["skylo_zz.pb", fixture("skylo_zz.pb")],
		["carrier_list.pb", Uint8Array.from([0x10, 0x01])],
	]);

	it("puts each file and its profile the first time, then only the carrier list once the index holds them", async () => {
		const first = counting(r2);
		const w = normWriter(first.bucket);
		const stored = await storeSettingsDir(
			directory(files),
			DIR,
			db,
			first.bucket,
			(a, bytes) => storeNormalized(w, a, bytes),
			"frankel",
		);
		// Two files, an artifact and a profile each, and the carrier list.
		expect(first.puts()).toBe(2 * 2 + 1);

		await indexed(
			Object.values(stored.sources)
				.flat()
				.map((a) => a.sha),
		);
		const next = counting(r2);
		const stores: string[] = [];
		expect(
			await storeSettingsDir(
				directory(files),
				DIR,
				db,
				next.bucket,
				async (a) => {
					stores.push(a.sha);
				},
				"frankel",
			),
		).toEqual(stored);
		expect(stores).toEqual([]);
		expect(next.puts()).toBe(1);
	});
});
