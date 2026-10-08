/** The carrier_list.pb a Pixel version shipped with, decoded on read: the Files tab's view of which SIMs load the version's file. */

import { error } from "@sveltejs/kit";
import { decodeCarrierList } from "@carrier-explode/decode-android";
import { carrierListRoutes, type SimRule } from "@carrier-explode/schema";
import { releaseSchema } from "@carrier-explode/schema/records";
import { keys } from "@carrier-explode/storage";
import { ruleRows, type SelectionRule } from "#lib/settings.ts";
import { cached } from "../cache";
import { copiesOfEntry, releasesOf, type Resolved } from "../catalog";
import { readBytes, readJson } from "../store";

export const CARRIER_LIST = "carrier_list.pb";

/** carrier_list.pb's rules naming one source: which SIMs load the file. */
export interface CarrierListView {
	readonly version: string | null;
	/** Every entry in the file, of every carrier. */
	readonly total: number;
	readonly size: number;
	readonly rules: readonly SelectionRule[];
}

/** The build the version was read with on its device: the newest shipping it there, else (an update file) the device's newest. */
async function buildOf(r: Resolved): Promise<string> {
	const shipping = copiesOfEntry(r.copies, r.entry)
		.flatMap((c) => (c.kind === "release" ? [c.release] : []))
		.toSorted((a, b) => b.sortKey.localeCompare(a.sortKey));
	const build = shipping[0]?.id ?? (await releasesOf("android")).find((x) => x.devices.includes(r.line))?.id;
	if (build === undefined) error(500, `${r.key} ${r.entry.slug}: no build of ${r.line} is held.`);
	return build;
}

/** The carrier list of the version's build on its device, with the rules naming the version's source. */
export async function carrierListOf(r: Resolved): Promise<CarrierListView> {
	const build = await buildOf(r);
	const key = keys.release("android", build, r.line);
	const release = await readJson(key, releaseSchema);
	if (release?.platform !== "android") error(500, `${key} is not a Pixel release record.`);
	return cached(`carrierlist:v1:${release.carrierList}:${r.key}`, async () => {
		const bytes = await readBytes(keys.obj(release.carrierList));
		if (!bytes) error(500, `${keys.obj(release.carrierList)} is not in the bucket.`);
		const list = decodeCarrierList(bytes);
		const routed: Readonly<Partial<Record<string, readonly SimRule[]>>> = carrierListRoutes(list);
		return {
			version: list.version ?? null,
			total: list.entries.length,
			size: bytes.length,
			rules: ruleRows(routed[r.key] ?? []),
		};
	});
}
