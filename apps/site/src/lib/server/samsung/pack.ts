/** Samsung views: one sales code's carrier pack on one Galaxy line at one version (catalog.ts Ver), decoded. */

import { error } from "@sveltejs/kit";
import {
	child,
	childrenNamed,
	decodeOmcText,
	openOmc,
	PACK_FILES,
	xmlValue,
	type Customer,
	type ImsOperator,
	type Pack,
	type XmlElement,
} from "@carrier-explode/decode-samsung";
import { imsTrees } from "@carrier-explode/schema";
import type { Json, SimMatcher, SourceRef } from "@carrier-explode/schema/types";
import { diffValues, summariseDiff, type DiffCounts, type DiffRow } from "@carrier-explode/values";
import { leafCount } from "#lib/settings.ts";
import type { ApnView, Ver, Version } from "#lib/types.ts";
import { decodedVersion, resolve, versionChanges, versionOf, type VersionChanges } from "../catalog";
import { mustProfile } from "../profiles";

const decoded = decodedVersion("samsung", openOmc);

/** The pack as value trees, one per file: what the Settings tab shows and the Changes tab diffs. */
function settingsOf(pack: Pack): Record<string, Json> {
	const out: Record<string, Json> = {};
	if (pack.customer) out[PACK_FILES.customer] = xmlValue(pack.customer.root);
	if (pack.cscFeature) out[PACK_FILES.cscFeature] = pack.cscFeature.features;
	if (pack.carrierFeature) {
		out[PACK_FILES.carrierFeature] = {
			customer: Object.fromEntries(pack.carrierFeature.groups.map((g) => [g.group, g.features])),
			specific: Object.fromEntries(pack.carrierFeature.carriers.map((c) => [c.id, c.features])),
		};
	}
	const { version, model, catalog } = pack.omcInfo;
	out[PACK_FILES.omcInfo] = { version, model, catalog };
	return pack.ims ? { ...out, ...imsTrees(pack.ims) } : out;
}

/**
 * What other views show, left out of customer.xml's tree: GeneralInfo's sales code and country are the page's header
 * and list, its networks Selected by; Connections' profiles the APNs.
 */
const SHOWN_ELSEWHERE: Readonly<Record<string, readonly string[]>> = {
	GeneralInfo: ["SalesCode", "Country", "CountryISO", "NetworkInfo", "NbNetworkInfo"],
	Connections: ["Profile", "ProfileHandle"],
};

const pruned = (e: XmlElement): XmlElement => ({
	...e,
	children: e.children.filter((c) => !SHOWN_ELSEWHERE[e.name]?.includes(c.name)).map(pruned),
});

interface SamsungFileValues {
	readonly file: string;
	readonly values: Json;
}

/** A pack file's settings, or the system IMS service's entries for the operator the pack's SIM rules match. */
export type SamsungSettingGroup =
	| (SamsungFileValues & { readonly kind: "pack"; readonly title: string })
	| { readonly kind: "ims"; readonly mno: string; readonly files: readonly SamsungFileValues[] };

const group = (title: string, file: string, values: Json | undefined): SamsungSettingGroup[] =>
	values === undefined ? [] : [{ kind: "pack", title, file, values }];

const imsGroup = (ims: ImsOperator): SamsungSettingGroup => ({
	kind: "ims",
	mno: ims.mno,
	files: Object.entries(imsTrees(ims)).map(([file, values]) => ({ file, values })),
});

/** The pack as the Settings tab reads it: customer.xml's settings, the feature switches, and the operator's IMS settings. */
function settingGroups(pack: Pack): SamsungSettingGroup[] {
	const all = settingsOf(pack);
	return [
		...group("Settings", PACK_FILES.customer, pack.customer && xmlValue(pruned(pack.customer.root))),
		...group("Features", PACK_FILES.cscFeature, all[PACK_FILES.cscFeature]),
		...group("Carrier features", PACK_FILES.carrierFeature, all[PACK_FILES.carrierFeature]),
		...(pack.ims ? [imsGroup(pack.ims)] : []),
	];
}

const groupValues = (g: SamsungSettingGroup): Json[] =>
	g.kind === "pack" ? [g.values] : g.files.map((f) => f.values);

/** The roles (`Browser`, `MMS`, `IMS`) its network's ProfileHandle gives a profile. */
const rolesOf = (customer: Customer, name: string | undefined, network: string | undefined): string[] => [
	...new Set(
		customer.handles
			.filter((h) => h.networkName === network)
			.flatMap((h) =>
				Object.entries(h.roles).flatMap(([role, p]) => (p === name ? [role.replace(/^Prof/, "")] : [])),
			),
	),
];

/** customer.xml's data profiles that name an APN, each as Settings.Connections.Profile writes it. */
function apnsOf(customer: Customer | undefined): ApnView[] {
	const settings = customer && child(customer.root, "Settings");
	const connections = settings && child(settings, "Connections");
	if (customer === undefined || connections === undefined) return [];
	const elements = childrenNamed(connections, "Profile");
	return customer.profiles.flatMap((p): ApnView[] => {
		const e = elements[p.index];
		if (e === undefined || p.apn === undefined) return [];
		const root = `Settings.Connections.Profile${elements.length > 1 ? `[${p.index}]` : ""}`;
		return [
			{
				name: p.name ?? null,
				apn: p.apn,
				roles: rolesOf(customer, p.name, p.networkName),
				root,
				fields: xmlValue(e),
			},
		];
	});
}

interface SamsungFileRow {
	readonly path: string;
	readonly size: number;
}

export interface SamsungVersion {
	readonly source: string;
	readonly ref: SourceRef;
	readonly line: string;
	readonly entry: Version;
	readonly previous: Version | null;
	/** omc.info's version, `SAOMC_SM-S931B_OXM_SFR_16_0007`. */
	readonly omc: string;
	/** The model omc.info names: Samsung reuses packs, so it may be another model's. */
	readonly model: string;
	readonly files: readonly SamsungFileRow[];
	/** omc.info's carrierList, as the stored profile reads it. */
	readonly sims: readonly SimMatcher[];
	readonly counts: { readonly settings: number; readonly apns: number; readonly files: number };
	readonly sha: string;
	readonly size: number;
}

export async function getSamsung(v: Ver): Promise<SamsungVersion> {
	const r = await resolve(v);
	const [d, entry, previous, profile] = await Promise.all([
		decoded(v),
		versionOf(r, r.entry),
		r.previous ? versionOf(r, r.previous) : null,
		mustProfile(r.entry),
	]);
	return {
		source: d.key,
		ref: d.ref,
		line: d.line,
		entry,
		previous,
		omc: d.file.omcInfo.version,
		model: d.file.omcInfo.model,
		files: [...d.file.files].map(([path, bytes]) => ({ path, size: bytes.length })),
		sims: profile.identity.sims,
		counts: {
			settings: leafCount(settingGroups(d.file).flatMap(groupValues)),
			apns: apnsOf(d.file.customer).length,
			files: d.file.files.size,
		},
		sha: d.sha,
		size: d.size,
	};
}

export async function getSamsungSettings(v: Ver): Promise<SamsungSettingGroup[]> {
	return settingGroups((await decoded(v)).file);
}

export async function getSamsungApns(v: Ver): Promise<ApnView[]> {
	return apnsOf((await decoded(v)).file.customer);
}

export interface SamsungFile {
	readonly path: string;
	/** The file decoded: Samsung's encoding undone, JSON indented. */
	readonly text: string;
}

export async function getSamsungFile(v: Ver, path: string): Promise<SamsungFile> {
	const d = await decoded(v);
	const bytes = d.file.files.get(path);
	if (!bytes) error(404, `${d.ref.name} ${d.entry.slug} has no file ${path}.`);
	const text = decodeOmcText(bytes);
	return { path, text: path.endsWith(".json") ? JSON.stringify(JSON.parse(text), null, 2) : text };
}

export type SamsungChanges = VersionChanges<{
	readonly rows: readonly DiffRow[];
	readonly counts: DiffCounts;
}>;

/** File by file and key by key: what the Changes tab and /compare show for two packs. */
export const { changes: getSamsungChanges, comparison: getSamsungComparison } = versionChanges(
	decoded,
	(a: Pack | null, b: Pack) => {
		const rows = diffValues(a ? settingsOf(a) : {}, settingsOf(b));
		return { rows, counts: summariseDiff(rows) };
	},
);
