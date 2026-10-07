/** The Features pages: one feature on one phone, for every carrier. */

import { error } from "@sveltejs/kit";
import * as v from "valibot";
import {
	scanConcept,
	statedDevices,
	statedSourceCounts,
	statesOn,
	type Page,
	type ShownDevice,
} from "@carrier-explode/db";
import { FEATURE_SLUGS, needs5G, type FeatureSlug } from "@carrier-explode/schema";
import {
	FEATURE_STATES,
	RELEASE_PLATFORMS,
	type Defaulted,
	type FeatureState,
	type ReleasePlatform,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { defaultedSchema } from "@carrier-explode/schema/records";
import { featurePage } from "#lib/feature-pages.ts";
import { perRequest } from "./cache";
import { db, everyPage } from "./db";
import { getCarriers, type ListEntry } from "./lists";

/** A phone a features page can show. `covered`: its states come from at least half as many sources as its platform's best-covered phone. */
export type FeaturePhone = ShownDevice & { readonly covered: boolean };

/** Every platform's phones that read phone states from some carrier, each platform's newest first. */
export const featurePhones = perRequest(async (): Promise<FeaturePhone[]> => {
	const d = await db();
	const platforms = await Promise.all(
		RELEASE_PLATFORMS.map(async (p) => {
			const [phones, counts] = await Promise.all([statedDevices(d, p), statedSourceCounts(d, p)]);
			const best = Math.max(0, ...counts.values());
			return phones.map((phone) =>
				Object.assign(phone, { covered: (counts.get(phone.code) ?? 0) * 2 >= best }),
			);
		}),
	);
	return platforms.flat();
});

/** The platform whose newest phone a features page shows when none is named. */
const FIRST_PLATFORM = "ios" satisfies ReleasePlatform;

/** The phone a features page is for: the one named, else the newest covered iPhone, else the newest covered phone the feature is on. */
export async function featurePhone(
	named: string | undefined,
	slug: FeatureSlug | undefined,
): Promise<FeaturePhone | null> {
	const phones = await featurePhones();
	const platforms = slug === undefined ? RELEASE_PLATFORMS : (featurePage(slug)?.platforms ?? []);
	const fallback = phones
		.filter((p) => p.covered && platforms.includes(p.platform))
		.toSorted(
			(a, b) =>
				Number(b.platform === FIRST_PLATFORM) - Number(a.platform === FIRST_PLATFORM) ||
				b.released.localeCompare(a.released),
		);
	return phones.find((p) => p.code === named) ?? fallback[0] ?? null;
}

async function mustPhone(code: string): Promise<ShownDevice> {
	const phone = (await featurePhones()).find((p) => p.code === code);
	if (!phone) error(404, `No phone ${code}.`);
	return phone;
}

/** "unset": the phone reads the source and nothing in it, or under it, decides; "unknown": the source ships nothing for this phone. */
export type PhoneState = FeatureState | "unset" | "unknown";

/** A phone without a 5G modem can use a 5G feature with no carrier. */
const unusable = (slug: FeatureSlug, phone: ShownDevice): boolean => needs5G(slug) && phone.has5g === false;

/** `defaulted`: what of a state the carrier leaves unset which layer under it decided. */
export type FeatureRow = ListEntry & { readonly state: PhoneState; readonly defaulted: Defaulted | null };

/** Every carrier's state for the feature on the phone, unless the phone cannot use it at all. */
export type FeatureTable =
	| { readonly unusable: true }
	| { readonly unusable: false; readonly rows: readonly FeatureRow[] };

/** A phone state as the concept scan reads it: canonical JSON, null where the phone's states lack the concept. */
const scannedState = v.pipe(v.string(), v.parseJson(), v.nullable(v.picklist(FEATURE_STATES)));
const scannedDefault = v.nullable(v.pipe(v.string(), v.parseJson(), defaultedSchema));

export async function getFeatureTable(slug: FeatureSlug, phoneId: string): Promise<FeatureTable> {
	const phone = await mustPhone(phoneId);
	if (unusable(slug, phone)) return { unusable: true };
	const [list, scanned] = await Promise.all([
		getCarriers(phone.platform),
		db().then((d) => scanConcept(d, { platform: phone.platform, kind: "carrier" }, slug, phone.code)),
	]);
	const read = new Map(
		scanned.map((s) => [
			s.source,
			{ state: v.parse(scannedState, s.value), defaulted: v.parse(scannedDefault, s.defaulted) },
		]),
	);
	return {
		unusable: false,
		// oxlint-disable-next-line oxc/no-map-spread -- the entries are the request cache's; assigning to them would change it.
		rows: list.map((entry) => {
			const r = read.get(entry.key);
			return {
				...entry,
				state: r === undefined ? "unknown" : (r.state ?? "unset"),
				defaulted: r?.defaulted ?? null,
			};
		}),
	};
}

export interface FeatureCount {
	readonly slug: FeatureSlug;
	readonly unusable: boolean;
	readonly counts: Readonly<Record<PhoneState, number>>;
}

/** How many carriers give each feature on one phone. */
export async function getFeatureSummary(phoneId: string): Promise<FeatureCount[]> {
	const phone = await mustPhone(phoneId);
	const d = await db();
	const [list, rows] = await Promise.all([
		getCarriers(phone.platform),
		everyPage(
			(page: Page<SourceKey>) => statesOn(d, phone.code, page),
			(r) => r.source,
		),
	]);
	const states = new Map(rows.map((r) => [r.source, r.states]));
	return FEATURE_SLUGS.map((slug) => {
		const counts = { on: 0, available: 0, no: 0, unset: 0, unknown: 0 };
		for (const { key } of list) {
			const read = states.get(key);
			counts[read === undefined ? "unknown" : (read[slug] ?? "unset")]++;
		}
		return { slug, unusable: unusable(slug, phone), counts };
	});
}
