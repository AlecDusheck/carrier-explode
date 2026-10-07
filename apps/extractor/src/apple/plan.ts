/** Which iOS builds to extract. Pure: the check fetches, this decides. */

import { compareProducts, compareVersions, isPrerelease, newestProduct } from "@carrier-explode/decode-ios";
import type { PipelineParams } from "../pipelines.ts";
import { iosInScope, type DatedDevice, type Scope } from "../scope.ts";
import type { AppleDbEntry, Firmware, IpswRef } from "./check.ts";

export type IosBuild = PipelineParams<"ios-build">;

/** One IPSW a catalogue lists for one phone, with what its build is planned with. */
export interface ListedIpsw extends IpswRef {
	readonly build: string;
	readonly major: number;
	readonly version: string;
	readonly label: string;
	readonly prerelease: boolean;
	readonly released?: string;
}

/** `27.1`, `27.1 beta 2` -> 27. */
const majorOf = (version: string): number => Number.parseInt(version, 10);

const released = (day: string | undefined): { released?: string } =>
	day === undefined ? {} : { released: day };

/** ipsw.me's IPSWs. */
export const listedReleases = (firmwares: readonly Firmware[]): ListedIpsw[] =>
	firmwares.map((f) => ({
		build: f.build,
		device: f.device,
		url: f.url,
		version: f.version,
		label: f.version,
		prerelease: isPrerelease(f.version),
		major: majorOf(f.version),
		...released(f.released),
	}));

/** AppleDB's beta IPSWs, which ipsw.me does not list. */
export const listedBetas = (entries: readonly AppleDbEntry[]): ListedIpsw[] =>
	entries
		.filter((e) => e.beta)
		.flatMap((e) =>
			// oxlint-disable-next-line oxc/no-map-spread -- the spreads only leave out absent optional fields; nothing is copied.
			[...e.ipsws].map(([device, url]) => ({
				build: e.build,
				device,
				url,
				version: e.version,
				label: e.version,
				prerelease: true,
				major: majorOf(e.version),
				...released(e.released),
			})),
		);

/** One entry per IPSW file (phones share files): `first`'s leads, then the newest phone's. */
export function distinctIpsws(pairs: readonly IpswRef[], first: string): IpswRef[] {
	const ordered = pairs.toSorted(
		(a, b) => Number(a.device !== first) - Number(b.device !== first) || compareProducts(b.device, a.device),
	);
	const byUrl = new Map<string, string>();
	for (const p of ordered) if (!byUrl.has(p.url)) byUrl.set(p.url, p.device);
	return [...byUrl].map(([url, device]) => ({ device, url }));
}

const newestFirst = (a: ListedIpsw, b: ListedIpsw): number =>
	compareVersions(b.version, a.version) || b.build.localeCompare(a.build);

/** The IPSWs before the cutoff the backfill rule keeps: every release and the newest major's betas, or each phone's newest. */
function backfill(
	rule: Scope["ios"]["backfill"],
	before: readonly ListedIpsw[],
	newestMajor: number,
): ListedIpsw[] {
	if (rule === "releases") return before.filter((i) => !i.prerelease || i.major === newestMajor);
	return [...Map.groupBy(before, (i) => i.device).values()].flatMap((ofPhone) =>
		ofPhone.toSorted(newestFirst).slice(0, 1),
	);
}

/**
 * The in-scope iPhones' IPSWs out on or after the cutoff (an undated one counts as out `today`), and the backfill
 * rule's of the rest, as builds whose release record (`held`: its phones, by build) lacks one of their phones, oldest
 * first; each with all its IPSWs, the newest phone's leading.
 */
export function planIos(
	scope: Scope,
	listed: readonly ListedIpsw[],
	devices: readonly DatedDevice[],
	held: ReadonlyMap<string, ReadonlySet<string>>,
	today: string,
): IosBuild[] {
	const phones = new Set(devices.filter((d) => iosInScope(scope, d)).map((d) => d.code));
	const ours = listed.filter((i) => phones.has(i.device) && i.major >= scope.ios.minMajor);
	const { everythingSince } = scope.ios;
	const isNew = (i: ListedIpsw): boolean =>
		everythingSince !== null && (i.released ?? today) >= everythingSince;
	const newestMajor = Math.max(...ours.map((i) => i.major));
	const taken = [
		...ours.filter(isNew),
		...backfill(
			scope.ios.backfill,
			ours.filter((i) => !isNew(i)),
			newestMajor,
		),
	];
	return [...Map.groupBy(taken, (i) => i.build).values()]
		.flatMap((ofBuild): IosBuild[] => {
			const [first] = ofBuild;
			if (first === undefined || ofBuild.every((i) => held.get(i.build)?.has(i.device))) return [];
			const pairs = ofBuild.map(({ device, url }) => ({ device, url }));
			const [lead, ...more] = distinctIpsws(pairs, newestProduct(pairs.map((p) => p.device)) ?? first.device);
			if (lead === undefined) return [];
			const { build, version, label, prerelease } = first;
			return [{ build, version, label, prerelease, ...released(first.released), ipsws: [lead, ...more] }];
		})
		.toSorted((a, b) => compareVersions(a.version, b.version) || a.build.localeCompare(b.build));
}

/** 24B5089g: build major 24, train B, lower-case suffix for a beta. */
const BETA_BUILD = /^(\d+)[A-Z]\d+[a-z]$/;
const RELEASE_BUILD = /^(\d+)[A-Z]\d+$/;

const buildMajor = (build: string): number | undefined => {
	const [, major] = BETA_BUILD.exec(build) ?? RELEASE_BUILD.exec(build) ?? [];
	return major === undefined ? undefined : Number(major);
};

/** AppleDB beta builds of the newest public release's major or a later one: the only betas a plan can take. Held ones too: a phone's newest build is chosen before what is held is left out. */
export function betaCandidates(keys: readonly string[], releases: readonly Firmware[]): string[] {
	const majors = releases.flatMap((f) => buildMajor(f.build) ?? []);
	const newest = majors.length ? Math.max(...majors) : undefined;
	return keys.flatMap((k) => {
		const [os, build = ""] = k.split(";");
		if (os !== "iOS" || !BETA_BUILD.test(build)) return [];
		const major = buildMajor(build);
		return newest === undefined || (major !== undefined && major >= newest) ? [build] : [];
	});
}
