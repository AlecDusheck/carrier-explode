/** Phones: listed by the feed checks, judged for 5G by the index step, read by pickers, features pages and build pages. */

import { and, eq, exists, sql } from "drizzle-orm";

import { newestFirst } from "@carrier-explode/schema";
import type { ReleasePlatform } from "@carrier-explode/schema/types";
import { chunks, qualified, run, type IndexDb } from "./db.ts";
import { labelled } from "./labels.ts";
import { devices, phoneStates, releases } from "./schema.ts";

/** A device as a feed check lists it. */
export type ListedDevice = Omit<typeof devices.$inferSelect, "has5g">;

/**
 * A feed's devices, written where they differ from what is stored. A device keeps the earliest release any check has
 * seen, so one whose first builds the feed has since dropped keeps its first day.
 */
export async function syncDevices(db: IndexDb, listed: readonly ListedDevice[]): Promise<number> {
	const held = new Map((await db.select().from(devices)).map((d) => [d.code, d]));
	const changed = listed.filter((d) => {
		const h = held.get(d.code);
		return (
			h === undefined ||
			d.released < h.released ||
			h.platform !== d.platform ||
			JSON.stringify(h.boards) !== JSON.stringify(d.boards)
		);
	});
	await run(
		db,
		chunks(changed, 4).map((some) =>
			db
				.insert(devices)
				.values(some)
				.onConflictDoUpdate({
					target: devices.code,
					set: {
						platform: sql`excluded.platform`,
						boards: sql`excluded.boards`,
						released: sql`min(${devices.released}, excluded.released)`,
					},
				}),
		),
	);
	return changed.length;
}

/** The index step's judgement of a device's 5G radio, from its newest release's own settings. */
export async function setHas5g(db: IndexDb, code: string, has5g: boolean | null): Promise<boolean> {
	const written = await db
		.update(devices)
		.set({ has5g })
		.where(and(eq(devices.code, code), sql`${devices.has5g} IS NOT ${has5g}`))
		.returning({ code: devices.code });
	return written.length > 0;
}

const shown = {
	code: devices.code,
	name: sql<string>`coalesce(${labelled("device", "name", devices.code)}, ${devices.code})`,
	platform: devices.platform,
	released: sql<string>`${labelled("device", "released", devices.code, devices.released)}`,
	boards: devices.boards,
	has5g: devices.has5g,
};

/** A device as pages show it: named, and released as people corrected it. */
export type ShownDevice = Omit<typeof devices.$inferSelect, "released"> & {
	readonly name: string;
	readonly released: string;
};

function inDeviceOrder(listed: readonly ShownDevice[]): ShownDevice[] {
	const order = newestFirst(listed);
	return listed.toSorted((a, b) => order(a.code, b.code));
}

/** One device, named. */
export function deviceOf(db: IndexDb, code: string): Promise<ShownDevice | undefined> {
	return db.select(shown).from(devices).where(eq(devices.code, code)).get();
}

/** A platform's phones, newest first: for pickers, features pages, build device order and the sitemap. */
export async function deviceList(db: IndexDb, platform: ReleasePlatform): Promise<ShownDevice[]> {
	return inDeviceOrder(await db.select(shown).from(devices).where(eq(devices.platform, platform)));
}

/** A platform's phones some indexed release lists, newest first: the phones phone states are derived for. */
export async function releasedDevices(db: IndexDb, platform: ReleasePlatform): Promise<ShownDevice[]> {
	return inDeviceOrder(
		await db
			.select(shown)
			.from(devices)
			.where(
				and(
					eq(devices.platform, platform),
					sql`EXISTS (SELECT 1 FROM ${releases} r, json_each(r.devices) j
            WHERE r.platform = ${platform} AND j.value = ${qualified(devices, devices.code)})`,
				),
			),
	);
}

/** A platform's phones that read phone states from some source, newest first: the features pages' phones. */
export async function statedDevices(db: IndexDb, platform: ReleasePlatform): Promise<ShownDevice[]> {
	return inDeviceOrder(
		await db
			.select(shown)
			.from(devices)
			.where(
				and(
					eq(devices.platform, platform),
					exists(
						db
							.select({ one: sql`1` })
							.from(phoneStates)
							.where(eq(phoneStates.device, devices.code)),
					),
				),
			),
	);
}

/** How many sources each of a platform's phones reads phone states from. */
export async function statedSourceCounts(
	db: IndexDb,
	platform: ReleasePlatform,
): Promise<Map<string, number>> {
	const rows = await db
		.select({ device: phoneStates.device, sources: sql<number>`count(*)` })
		.from(phoneStates)
		.innerJoin(devices, eq(devices.code, phoneStates.device))
		.where(eq(devices.platform, platform))
		.groupBy(phoneStates.device);
	return new Map(rows.map((r) => [r.device, r.sources]));
}
