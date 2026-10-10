/** The Features pages: one feature on one phone, for every carrier. */

import { error } from "@sveltejs/kit";
import * as v from "valibot";
import {
	headConcepts,
	scanConcept,
	statedDevices,
	statedSourceCounts,
	statesOn,
	type Page,
	type ShownDevice,
} from "@carrier-explode/db";
import { needs5G, perPhone, phoneVariantId, profileFor, type FeatureSlug } from "@carrier-explode/schema";
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
import type { ModelChoice } from "#lib/phones.ts";
import {
	isSetting,
	isTreeConcept,
	phoneConcepts,
	type MatrixCell,
	type MatrixConcept,
	type SettingValue,
	type TreeConcept,
} from "#lib/feature-matrix.ts";
import type { Ver } from "#lib/types.ts";
import { perRequest } from "./cache";
import { resolve } from "./catalog";
import { db, everyPage } from "./db";
import { getCarriers, getCountryCarriers, type ListEntry } from "./lists";
import { modelChoices } from "./phones";
import { profileAt } from "./profiles";
import { overridePlistOf } from "./apple/phones";

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

/** The features pages' phones as the phone picker offers them: each platform's grouped into phones. */
export const featureModels = perRequest(async (): Promise<ModelChoice[]> => {
	const phones = await featurePhones();
	const models = await Promise.all(
		RELEASE_PLATFORMS.map((p) =>
			modelChoices(
				p,
				phones.filter((phone) => phone.platform === p),
				(name) => name,
				p,
			),
		),
	);
	return models.flat();
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

async function mustPhone(code: string): Promise<FeaturePhone> {
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

/** Every carrier source's feature states on one phone, by source. */
async function statesBySource(
	device: string,
): Promise<Map<SourceKey, Readonly<Record<string, FeatureState>>>> {
	const d = await db();
	const rows = await everyPage(
		(page: Page<SourceKey>) => statesOn(d, device, page),
		(r) => r.source,
	);
	return new Map(rows.map((r) => [r.source, r.states]));
}

const phoneState = (states: Readonly<Record<string, FeatureState>> | undefined, slug: string): PhoneState =>
	states === undefined ? "unknown" : (states[slug] ?? "unset");

const settingValue = v.pipe(
	v.string(),
	v.parseJson(),
	v.nullable(v.union([v.string(), v.number(), v.boolean(), v.array(v.union([v.string(), v.number()]))])),
);

const settingCell = (value: SettingValue | null | undefined): MatrixCell =>
	value === undefined ? "unknown" : value === null ? "unset" : { value };

export interface MatrixRow {
	readonly entry: ListEntry;
	/** In `FeatureMatrix.columns` order. */
	readonly cells: readonly MatrixCell[];
}

export interface FeatureMatrix {
	readonly phone: FeaturePhone;
	readonly columns: readonly MatrixConcept[];
	readonly rows: readonly MatrixRow[];
}

/** What every carrier gives one phone: its feature states, and the settings its own file makes. */
export async function getFeatureMatrix(phoneId: string): Promise<FeatureMatrix> {
	const phone = await mustPhone(phoneId);
	const columns = phoneConcepts(phone);
	const group = { platform: phone.platform, kind: "carrier" } as const;
	const d = await db();
	const [list, states, settings] = await Promise.all([
		getCarriers(phone.platform),
		statesBySource(phone.code),
		Promise.all(
			columns.filter(isSetting).map(async (id) => {
				const scanned = await scanConcept(d, group, id, phone.code);
				return [id, new Map(scanned.map((s) => [s.source, v.parse(settingValue, s.value)]))] as const;
			}),
		),
	]);
	const byId = new Map<MatrixConcept, ReadonlyMap<SourceKey, SettingValue | null>>(settings);
	return {
		phone,
		columns,
		rows: list.map((entry) => ({
			entry,
			cells: columns.map((id) => {
				const setting = byId.get(id);
				return setting === undefined
					? phoneState(states.get(entry.key), id)
					: settingCell(setting.get(entry.key));
			}),
		})),
	};
}

/** What a country's carriers give its platform's newest covered phone, or the one named. */
export async function getCountryMatrix(
	platform: ReleasePlatform,
	iso: string,
	named: string | undefined,
): Promise<FeatureMatrix | null> {
	const phone = await treePhone(platform, named === undefined ? [] : [named]);
	if (phone === null) return null;
	const [matrix, carriers] = await Promise.all([
		getFeatureMatrix(phone.code),
		getCountryCarriers(platform, iso),
	]);
	const keys = new Set(carriers.map((c) => c.key));
	return { ...matrix, rows: matrix.rows.filter((r) => keys.has(r.entry.key)) };
}

/** What one source's head gives: a carrier's on `phone`, a country bundle's alone. Only a head has index rows. */
export type SourceFeatures =
	| { readonly state: "notHead" }
	| {
			readonly state: "judged";
			readonly phone: FeaturePhone | null;
			readonly cells: ReadonlyArray<readonly [TreeConcept, MatrixCell]>;
			/** By concept, the native settings it is read from, as `file:path`; none when the file leaves it unset. */
			readonly keys: Readonly<Record<string, readonly string[]>>;
	  };

/** The newest of `candidates` with phone states; with none named, the platform's newest covered phone. */
async function treePhone(
	platform: ReleasePlatform,
	candidates: readonly string[],
): Promise<FeaturePhone | null> {
	const phones = (await featurePhones()).filter((p) => p.platform === platform);
	return (
		(candidates.length ? phones.find((p) => candidates.includes(p.code)) : phones.find((p) => p.covered)) ??
		null
	);
}

/**
 * `phones`: the phones the page shows the source for; a carrier none of them has states for gives its settings alone.
 * `file`: the Apple override file those phones read, as `?file=` names it; each feature's keys are then theirs.
 */
export async function getSourceFeatures(
	at: Ver,
	phones: readonly string[],
	file: string | null,
): Promise<SourceFeatures> {
	const r = await resolve(at);
	if (r.entry.sha !== r.source.headSha) return { state: "notHead" };
	const platform = RELEASE_PLATFORMS.find((p) => p === r.ref.platform);
	const phone =
		r.ref.kind === "carrier" && platform !== undefined && phones.length
			? await treePhone(platform, phones)
			: null;
	const head = await headConcepts(await db(), r.key, phone?.code ?? "");
	const values = new Map(head.values.map((c) => [c.concept, v.parse(settingValue, c.value)]));
	const states = head.states ?? undefined;
	const cells =
		phone === null
			? [...values].flatMap(([id, value]) =>
					isTreeConcept(id) && !perPhone(r.ref.kind, id) ? [[id, settingCell(value)] as const] : [],
				)
			: phoneConcepts(phone).map(
					(id) => [id, isSetting(id) ? settingCell(values.get(id)) : phoneState(states, id)] as const,
				);
	const profile = await profileAt(r.entry);
	const seen =
		profile === null || file === null ? profile : profileFor(profile, phoneVariantId(overridePlistOf(file)));
	const keys = Object.fromEntries(
		cells.map(([id]) => {
			const c = seen?.concepts[id];
			return [id, c === undefined || c.kind === "unset" ? [] : [...new Set(c.because.map((b) => b.path))]];
		}),
	);
	return { state: "judged", phone, cells, keys };
}
