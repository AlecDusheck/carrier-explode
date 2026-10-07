/** iOS modem packages: each build's packages (the index's modems rows), their summaries, and what a bundle's phones run from them, as the builds pages and the Modem tab read them. */

import { error } from "@sveltejs/kit";
import {
	MODEM_SUMMARY_SCHEMA,
	basebandComparable,
	carriedBy,
	comboTagPlmns,
	diffKeyed,
	mergeComboSets,
	newestProduct,
	priReplacements,
	priText,
	isTextFile,
	type BasebandByteFile,
	type BasebandFile,
	type BasebandSummary,
	type BasebandTextFile,
	type ComboSetRow,
	type FileDiff,
	type FtabSummary,
	type ModemSummary,
	type PriReplacement,
} from "@carrier-explode/decode-ios";
import { routedBundles, type RoutedBundles } from "@carrier-explode/db";
import { parseBandCombos } from "@carrier-explode/decode-qualcomm";
import { countryName, isoForMcc } from "@carrier-explode/schema";
import { MAIN_LINE, sourceKey, type ModemKind } from "@carrier-explode/schema/types";
import { diffValues, summariseDiff, type DiffCounts, type DiffRow } from "@carrier-explode/values";
import { overridesFor, sharedPri } from "#lib/apple/phones.ts";
import type { Named, Ver } from "#lib/types.ts";
import { cached, perRequest } from "../cache";
import { db } from "../db";
import { mustRelease, shippedVersion } from "../releases";
import { readJson } from "../store";
import { open, readPri } from "./bytes";
import * as records from "./modem-records";
import { modemViews, packagesOf, summaryKey, type ModemView } from "./modems";
import { phoneCopies } from "./phones";

const modemSummary = perRequest((id: string): Promise<ModemSummary | null> =>
	readJson(summaryKey(id), records.modemSummary),
);

async function mustSummary(id: string): Promise<ModemSummary> {
	const s = await modemSummary(id);
	if (!s) error(404, `No summary for modem package ${id}.`);
	return s;
}

async function mustBbfw(id: string): Promise<BasebandSummary> {
	const s = await mustSummary(id);
	if (s.kind !== "bbfw") error(404, `${id} is not a .bbfw package`);
	return s;
}

/** The build's package of `family` and `kind`, by its sha. */
async function releaseModem(
	build: string,
	family: string,
	kind: ModemKind,
): Promise<{ version: string; id: string }> {
	const [release, modems] = await Promise.all([mustRelease("ios", build), packagesOf(build)]);
	const m = modems.find((x) => x.family === family && x.kind === kind);
	if (!m)
		error(
			404,
			`iOS ${release.version} (${build}) has no ${family} ${kind === "bbfw" ? ".bbfw" : "ftab"} modem package.`,
		);
	return { version: release.version, id: m.package };
}

export interface BuildModems {
	readonly build: string;
	readonly version: string;
	readonly modems: readonly ModemView[];
	/** The page of the Default bundle this build ships, which holds the regional band tables; null when not indexed. */
	readonly defaultBundle: string | null;
}

const DEFAULT_BUNDLE = sourceKey({ platform: "ios", kind: "carrier", name: "Default" });

/** A build's modem packages, one per distinct package, with the phones each serves; newest phones first. */
export async function getModemPackages(build: string): Promise<BuildModems> {
	const [release, modems, defaults] = await Promise.all([
		mustRelease("ios", build),
		modemViews(build),
		shippedVersion("ios", build, DEFAULT_BUNDLE, MAIN_LINE),
	]);
	return { build, version: release.version, modems, defaultBundle: defaults?.path ?? null };
}

/** A package file without its content, which stays on the server until asked for. */
function listed(f: BasebandFile): Omit<BasebandTextFile, "text"> | Omit<BasebandByteFile, "hex"> {
	if (isTextFile(f)) {
		const { text: _text, ...rest } = f;
		return rest;
	}
	const { hex: _hex, ...rest } = f;
	return rest;
}

type MccCountries = Record<string, { cc: string; name: string | undefined }>;

type NvRecord = BasebandSummary["nv"][number]["records"][number];

/** A .bbfw package as its pages read it: file contents and NV values stay on the server until asked for. */
interface BbfwView {
	readonly kind: "bbfw";
	readonly package: BasebandSummary["package"];
	readonly members: BasebandSummary["members"];
	readonly containers: ReadonlyArray<Omit<BasebandSummary["containers"][number], "meta">>;
	readonly files: ReadonlyArray<
		(Omit<BasebandTextFile, "text"> | Omit<BasebandByteFile, "hex">) & { readonly i: number }
	>;
	readonly nv: ReadonlyArray<
		Omit<BasebandSummary["nv"][number], "records"> & {
			readonly records: ReadonlyArray<
				Pick<NvRecord, "nv" | "efs" | "hex" | "name" | "meaning" | "label" | "confidence">
			>;
		}
	>;
	readonly images: BasebandSummary["images"];
	readonly bandCombos: BasebandSummary["bandCombos"];
	readonly amprNs: BasebandSummary["amprNs"];
	readonly mccs: MccCountries;
	readonly modemConfigs: NonNullable<BasebandSummary["modemConfigs"]> | null;
	/** What Apple's manifest routes each band-combo tag's PLMNs to. */
	readonly tagBundles: Readonly<Record<string, RoutedBundles>>;
	/** What it routes each network database PLMN to. */
	readonly networkBundles: Readonly<Record<string, RoutedBundles>>;
	readonly mdb: NonNullable<BasebandSummary["mdb"]> | null;
	readonly ssgccs: NonNullable<BasebandSummary["ssgccs"]> | null;
}

function mccCountries(mccs: Iterable<string>): MccCountries {
	const out: MccCountries = {};
	for (const mcc of mccs) {
		const cc = isoForMcc(mcc);
		if (cc) out[mcc] = { cc, name: countryName(cc) };
	}
	return out;
}

/** Firmware spells a PLMN "310-260"; routes key it "310260". */
const mccmnc = (plmn: string): string => plmn.replace("-", "");

/** The routes of each group of firmware PLMNs. */
const bundlesOf = async (
	groups: Iterable<readonly [string, readonly string[]]>,
): Promise<Record<string, RoutedBundles>> =>
	routedBundles(await db(), Object.fromEntries([...groups].map(([k, plmns]) => [k, plmns.map(mccmnc)])));

/** The page's view of a .bbfw package: everything but file contents and NV values. */
async function bbfwView(s: BasebandSummary): Promise<BbfwView> {
	const mccs = new Set([
		...s.amprNs.flatMap((a) => a.groups.flatMap((g) => g.mccs)),
		...(s.mdb?.databases ?? []).flatMap((d) => d.scan?.flatMap((e) => (e.mcc ? [e.mcc] : [])) ?? []),
	]);
	const networks = new Set(
		(s.mdb?.databases ?? []).flatMap((d) => d.features?.flatMap((f) => f.plmns) ?? []),
	);
	const [tagBundles, networkBundles] = await Promise.all([
		bundlesOf(comboTagPlmns(s.bandCombos)),
		bundlesOf([...networks].map((p) => [p, [p]] as const)),
	]);
	return {
		kind: s.kind,
		package: s.package,
		members: s.members,
		// The header metadata is build-system placeholders apart from the version the page already names.
		containers: s.containers.map(({ meta: _meta, ...c }) => c),
		files: s.files.map((f, i) => ({ ...listed(f), i })),
		nv: s.nv.map(({ records: nvRecords, ...n }) => ({
			...n,
			records: nvRecords.map(({ f11: _f11, f14: _f14, f77: _f77, f78: _f78, ...shown }) => shown),
		})),
		images: s.images,
		bandCombos: s.bandCombos,
		amprNs: s.amprNs,
		mccs: mccCountries(mccs),
		modemConfigs: s.modemConfigs ?? null,
		tagBundles,
		networkBundles,
		mdb: s.mdb ?? null,
		ssgccs: s.ssgccs ?? null,
	};
}

/** What a package page without a full view shows: the package header, and an ftab's entry table. */
export type PackageHeader =
	| FtabSummary
	| { readonly kind: "bbfw"; readonly package: BasebandSummary["package"] };

export async function getModemPackageHeader(id: string): Promise<PackageHeader> {
	const s = await mustSummary(id);
	return s.kind === "ftab" ? s : { kind: s.kind, package: s.package };
}

export type BasebandPage = BbfwView & {
	readonly build: string;
	readonly version: string;
	readonly family: string;
	readonly id: string;
};

/** A release's .bbfw package of `family`. */
export async function getBaseband(build: string, family: string): Promise<BasebandPage> {
	const { version, id } = await releaseModem(build, family, "bbfw");
	const view = await bbfwView(await mustBbfw(id));
	return { build, version, family, id, ...view };
}

export type PackageFile = BasebandSummary["files"][number] & { readonly i: number };

export async function getBasebandFile(id: string, i: number): Promise<PackageFile> {
	const f = (await mustBbfw(id)).files[i];
	if (!f) error(404, `no file ${i} in modem package ${id}`);
	return { ...f, i };
}

/** One carrier's combo strings from one band_combos_per_plmn.xml variant. */
export async function getBasebandCombos(id: string, sha1: string, tag: string): Promise<string[]> {
	const f = (await mustBbfw(id)).files.find(
		(x) => x.sha1 === sha1 && x.path.endsWith("/band_combos_per_plmn.xml"),
	);
	if (!f || !isTextFile(f)) error(404, `no band combo file ${sha1}`);
	const c = parseBandCombos(f.text).find((x) => x.tag === tag);
	if (!c) error(404, `no ${tag} in ${sha1}`);
	return c.combos;
}

/** One part of a modem package diff, under the section it belongs to. */
export interface BasebandDiffPart extends FileDiff {
	readonly section: string;
}

export interface BasebandDiff {
	readonly family: string;
	readonly a: { readonly build: string; readonly version: string; readonly id: string };
	readonly b: { readonly build: string; readonly version: string; readonly id: string };
	readonly parts: BasebandDiffPart[];
	readonly counts: DiffCounts;
}

/** One family's package in build `b` against build `a`, part by part. */
export async function getBasebandDiff(a: string, b: string, family: string): Promise<BasebandDiff> {
	const [A, B] = await Promise.all([releaseModem(a, family, "bbfw"), releaseModem(b, family, "bbfw")]);
	const diff = await cached(`bbdiff:v${MODEM_SUMMARY_SCHEMA}:${A.id}|${B.id}`, async () => {
		const [ca, cb] = (await Promise.all([mustBbfw(A.id), mustBbfw(B.id)])).map(basebandComparable);
		const parts: BasebandDiffPart[] = Object.entries(cb ?? {}).flatMap(([section, after]) =>
			diffKeyed(ca?.[section] ?? {}, after, { maxRows: 300 }).map((p) => Object.assign(p, { section })),
		);
		return { parts, counts: summariseDiff(parts) };
	});
	return {
		family,
		a: { build: a, version: A.version, id: A.id },
		b: { build: b, version: B.version, id: B.id },
		...diff,
	};
}

/** A package summary for the bundle views (phones' modem defaults); null when not stored. */
async function bbfwSummary(id: string): Promise<BasebandSummary | null> {
	const s = await modemSummary(id);
	return s?.kind === "bbfw" ? s : null;
}

interface ComboTag {
	readonly tag: string;
	readonly plmns: readonly string[];
	readonly primary: boolean;
	readonly sets: readonly ComboSetRow[];
}

export type ModemDefaults =
	| { readonly missing: true; readonly build: string | null }
	| {
			readonly missing: false;
			readonly build: string;
			readonly version: string;
			readonly family: Named;
			readonly id: string;
			readonly phone: string;
			readonly tags: readonly ComboTag[];
			readonly overrides: ReadonlyArray<{ readonly pri: string } & PriReplacement>;
			readonly otherXml: number;
			/** The version the .der.pri files were read from, for getBasebandOverride. */
			readonly slug: string;
	  };

/**
 * What `device`'s modem runs for this bundle before its .der.pri lands: the band-combo carrier tags whose PLMNs
 * route here, and the package files that .der.pri replaces by EFS path. Without `device`, the home phone.
 */
export async function getBasebandDefaults(at: Ver, device?: string): Promise<ModemDefaults> {
	const v = await phoneCopies(at);
	if (!v) return { missing: true, build: null };
	// Without a phone named, the newest one the release is read against.
	const phone = device ?? newestProduct(at.line ? [at.line] : v.devices);
	const m = phone ? v.modems.find((x) => x.devices.includes(phone) && x.kind === "bbfw") : undefined;
	const [{ opened, files, ref }, s] = await Promise.all([open(at), m ? bbfwSummary(m.package) : null]);
	if (!phone || !m || !s) return { missing: true, build: v.build };

	const key = sourceKey({ ...ref, platform: "ios" });
	const tagPlmns = comboTagPlmns(s.bandCombos);
	const routed = await bundlesOf(tagPlmns);
	const tags = [...tagPlmns]
		.filter(([tag]) => routed[tag]?.bundles.includes(key) || routed[tag]?.mvnoBundles.includes(key))
		.map(([tag, plmns]): ComboTag => ({
			tag,
			plmns,
			primary: routed[tag]?.bundles.includes(key) ?? false,
			sets: mergeComboSets(s.bandCombos, tag),
		}));

	const own = new Set([...overridesFor(files, phone), ...sharedPri(files)].map((f) => f.path));
	const overrides: Array<{ pri: string } & PriReplacement> = [];
	let otherXml = 0;
	for (const file of opened.info.files) {
		const pri = file.kind === "pri-der" && own.has(file.path) ? readPri(opened, file.path) : undefined;
		if (!pri) continue;
		const r = priReplacements(pri, s);
		overrides.push(...r.replaced.map((x) => ({ pri: file.path, ...x })));
		otherXml += r.otherXml;
	}
	const release = await mustRelease("ios", v.build);
	return {
		missing: false,
		build: v.build,
		version: release.version,
		family: { code: m.family, name: m.familyName },
		id: m.package,
		phone,
		tags,
		overrides,
		otherXml,
		slug: v.entry.slug,
	};
}

export interface ModemOverride {
	readonly id: string;
	readonly efs: string;
	readonly pri: string;
	readonly where: string;
	readonly member: string;
	readonly baseline: string;
	readonly override: string;
	readonly rows: readonly DiffRow[];
	readonly counts: DiffCounts;
}

/** File `i` of modem package `id` next to the .der.pri value that replaces it, with the lines that differ. */
export async function getBasebandOverride(
	v: Ver,
	id: string,
	pri: string,
	efs: string,
	i: number,
): Promise<ModemOverride> {
	const [{ opened }, s] = await Promise.all([open(v), bbfwSummary(id)]);
	const base = s?.files[i];
	if (!base || !isTextFile(base) || base.path !== efs) error(404, `no package file ${i} at ${efs}`);
	const value = readPri(opened, pri)?.efs.find((e) => e.path === efs)?.value;
	const text = value && priText(value);
	if (text === undefined) error(404, `${pri} does not set ${efs}`);
	const rows = diffValues(base.text.split("\n"), text.split("\n"));
	return {
		id,
		efs,
		pri,
		where: carriedBy(base),
		member: base.member,
		baseline: base.text,
		override: text,
		rows,
		counts: summariseDiff(rows),
	};
}
