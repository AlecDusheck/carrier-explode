/** Sources and their versions as requests name them: found in the index, resolved on a line, and read decoded from the bucket. */

import { deviceList, entriesOf, sourceOf, type ListedSource, type SourceRow } from "@carrier-explode/db";
import { head, newestFirst, versionOn, type DeviceOrder, type TimelineEntry } from "@carrier-explode/schema";
import type * as v from "valibot";
import { profileSchema } from "@carrier-explode/schema/records";
import {
	isReleasePlatform,
	sourceKey,
	type Platform,
	type SourceKey,
	type SourceRef,
} from "@carrier-explode/schema/types";
import { keys, readRecord } from "@carrier-explode/storage";
import { fail, type ApiContext } from "./context.ts";
import type { ProfileField } from "./shapes.ts";

/** How a platform orders its devices, newest first: which line is a source's default. */
async function deviceOrder(c: ApiContext, platform: Platform): Promise<DeviceOrder> {
	return newestFirst(isReleasePlatform(platform) ? await deviceList(c.var.db, platform) : []);
}

export interface Located {
	readonly ref: SourceRef;
	readonly key: SourceKey;
	readonly row: NonNullable<Awaited<ReturnType<typeof sourceOf>>>;
	readonly timeline: readonly TimelineEntry[];
	readonly order: DeviceOrder;
}

/** The source `ref` names, its timeline, and how its platform orders devices. */
export async function locate(c: ApiContext, ref: SourceRef): Promise<Located> {
	const key = sourceKey(ref);
	const [row, timeline, order] = await Promise.all([
		sourceOf(c.var.db, key),
		entriesOf(c.var.db, key),
		deviceOrder(c, ref.platform),
	]);
	if (!row) throw fail(404, `No source ${key}.`);
	return { ref, key, row, timeline, order };
}

/** A version on its line. */
export interface AtVersion {
	readonly key: SourceKey;
	readonly line: string;
	readonly entry: TimelineEntry;
	readonly previous: TimelineEntry | null;
}

/** The version `slug` names on `line`, each defaulted as versionOn defaults it, or a 404 saying which is missing. */
export function versionAt(at: Located, line: string | undefined, slug: string | undefined): AtVersion {
	const found = versionOn(at.ref, at.timeline, at.order, line, slug);
	if (!found.found)
		throw fail(
			404,
			found.missing === "line"
				? `${at.key} has no line ${line ?? ""}.`
				: `${at.key} has no version ${slug ?? ""} on line ${line ?? "(default)"}.`,
		);
	return { key: at.key, line: found.line, entry: found.entry, previous: found.previous };
}

/** A version's decoded settings, as the bucket holds them. */
export type StoredProfile = v.InferOutput<typeof profileSchema>;

/** The Profile a version's sha holds. */
export async function profileOf(c: ApiContext, key: SourceKey, sha: string): Promise<StoredProfile> {
	const profile = await readRecord(c.env.BUCKET, keys.profile(sha), profileSchema);
	if (!profile) throw fail(404, `${key} ${sha} is not decoded yet.`);
	return profile;
}

/** A Profile with only the fields asked for, besides what names it. */
export function selected(
	{ source, sha, ...parts }: StoredProfile,
	fields: ReadonlySet<ProfileField>,
): Pick<StoredProfile, "source" | "sha"> & Partial<Pick<StoredProfile, ProfileField>> {
	return {
		source,
		sha,
		...(fields.has("identity") ? { identity: parts.identity } : {}),
		...(fields.has("apns") ? { apns: parts.apns } : {}),
		...(fields.has("concepts") ? { concepts: parts.concepts } : {}),
		...(fields.has("variants") ? { variants: parts.variants } : {}),
	};
}

/** Each source's head: the version a phone reads when none is named. */
export async function headsOf(
	c: ApiContext,
	rows: ReadonlyArray<Pick<SourceRow, "key" | "platform" | "kind" | "name">>,
): Promise<ReadonlyMap<SourceKey, TimelineEntry>> {
	const orders = new Map<Platform, Promise<DeviceOrder>>();
	const orderOf = (p: Platform): Promise<DeviceOrder> => {
		const known = orders.get(p) ?? deviceOrder(c, p);
		orders.set(p, known);
		return known;
	};
	const heads = await Promise.all(
		rows.map(async (ref) => {
			const [timeline, order] = await Promise.all([entriesOf(c.var.db, ref.key), orderOf(ref.platform)]);
			const at = head(ref, timeline, order);
			if (at === undefined) throw new Error(`${ref.key}: a source with no versions`);
			return [ref.key, at] as const;
		}),
	);
	return new Map(heads);
}

/** A source's carrier as answers name it. */
export const carrierRef = (
	s: Pick<ListedSource, "carrier" | "carrierName">,
): { readonly id: string; readonly name: string } | null =>
	s.carrier === null || s.carrierName === null ? null : { id: s.carrier, name: s.carrierName };
