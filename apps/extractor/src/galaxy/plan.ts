/** Which Galaxy firmware to extract. Pure: the check fetches, this decides. */

import * as v from "valibot";

import { compareUtf8 } from "@carrier-explode/binary";
import type { ListedDevice } from "@carrier-explode/db";
import type { Label } from "@carrier-explode/schema/records";
import { DataError } from "../errors.ts";
import type { PipelineParams } from "../pipelines.ts";
import type { Scope } from "../scope.ts";
import type { GalaxyPhone } from "./phones.ts";

export type GalaxyBuild = PipelineParams<"galaxy-build">;
/** A firmware as version.xml lists it, before its major is read. */
type GalaxyFirmware = Omit<GalaxyBuild, "major">;
/** A firmware and its phone's line. */
export type Candidate = GalaxyFirmware & Pick<GalaxyPhone, "line">;

/** What FUS and the firmware's zip directory say of a firmware: what planning scopes by, and its phone's record. */
const firmwareFactsSchema = v.object({
	/** The Android major its AP member names (`…_OS17…`). */
	major: v.pipe(v.number(), v.integer()),
	/** The day it was built. */
	released: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
	/** Its phone's name as Samsung displays it (`Galaxy S26 (SM-S942U)`). */
	name: v.pipe(v.string(), v.minLength(1)),
});
export type FirmwareFacts = Readonly<v.InferOutput<typeof firmwareFactsSchema>>;

/** What FUS answered of a firmware: its facts, or the day it said it does not serve it. */
export const firmwareAnswerSchema = v.union([
	firmwareFactsSchema,
	v.object({ refused: v.pipe(v.string(), v.isoDate()) }),
]);
export type FirmwareAnswer = Readonly<v.InferOutput<typeof firmwareAnswerSchema>>;

/** A phone on a region, with the `PDA/CSC/PHONE/DATA` builds its version.xml lists. */
export interface ListedFirmware extends GalaxyPhone {
	readonly region: string;
	readonly versions: readonly string[];
}

/** `PDA/CSC/PHONE` (version.xml) → `PDA/CSC/PHONE/PDA` (what BinaryInform asks for: DATA is the PDA build). */
export function fusVersion(listed: string): string | undefined {
	const [pda, csc, phone = "", data] = listed.trim().split("/");
	if (!pda || !csc) return undefined;
	return `${pda}/${csc}/${phone || pda}/${data || pda}`;
}

/**
 * A CSC build ends in its multi-CSC package's code, then its bootloader, OS-upgrade, year, month and revision characters
 * (`S942BOXM4BZIG`: OXM; 4, B, Z, I, G).
 */
export const packageOf = (build: string): string => build.slice(-8, -5);
const upgradeOf = (build: string): string => build.slice(-4, -3);
/** A model's builds of one package share all but their last five characters (`S942BOXM`). */
const packageLine = (build: string): string => build.slice(0, -5);

const LETTER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const A_YEAR = 2001;

function datedMonth(build: string, today: string): string | undefined {
	const [year, month, revision] = build.slice(-3);
	const y = LETTER.indexOf(year ?? "");
	const m = "ABCDEFGHIJKL".indexOf(month ?? "");
	if (y < 0 || m < 0 || revision === undefined || !/^[0-9A-Z]$/.test(revision)) return undefined;
	const thisYear = Number.parseInt(today.slice(0, 4), 10);
	const built = thisYear - ((((thisYear - A_YEAR - y) % LETTER.length) + LETTER.length) % LETTER.length);
	return `${built}-${String(m + 1).padStart(2, "0")}${revision}`;
}

/**
 * `2026-09D` for `…4BZID`: the build's year and month, then its revision, which counts 1–9 then A–Z. The year letter
 * cycles every 26 years, so it is the latest year up to `today`'s that has it.
 */
export function buildMonth(build: string, today: string): string {
	const month = datedMonth(build, today);
	if (month === undefined) throw new DataError(`${build}: no year, month and revision at its end`);
	return month;
}

/**
 * Whether a phone's CSC builds all date from `since` (`YYYY-MM`) on, so it launched then. Not every old build's month
 * decodes, so one older build rules a phone out before the rest must date.
 */
/** YYYY-MM of the oldest of `builds` whose month decodes. */
export function oldestMonth(builds: readonly string[], today: string): string | undefined {
	return builds
		.flatMap((b) => datedMonth(b, today)?.slice(0, 7) ?? [])
		.reduce<string | undefined>((min, m) => (min === undefined || m < min ? m : min), undefined);
}

export function launchedSince(builds: readonly string[], since: string, today: string): boolean {
	const older = builds.some((b) => {
		const month = datedMonth(b, today);
		return month !== undefined && month < since;
	});
	return !older && builds.length > 0 && builds.every((b) => buildMonth(b, today) >= since);
}

/**
 * Each model's newest build of each package and OS upgrade: the candidates whose majors a check reads. The sales codes
 * a package serves list the same build, so each is a candidate once.
 */
export function candidates(listed: readonly ListedFirmware[], today: string): Candidate[] {
	const builds = new Map<string, Candidate>();
	for (const l of listed) {
		for (const listedVersion of l.versions) {
			const version = fusVersion(listedVersion);
			const build = version?.split("/")[1];
			if (version !== undefined && build !== undefined && !builds.has(build))
				builds.set(build, { model: l.model, region: l.region, version, build, line: l.line });
		}
	}
	const month = (b: Candidate): string => buildMonth(b.build, today);
	return [
		...Map.groupBy(builds.values(), (b) => `${packageLine(b.build)} ${upgradeOf(b.build)}`).values(),
	].flatMap((bs) => bs.toSorted((a, b) => compareUtf8(month(b), month(a))).slice(0, 1));
}

/** A candidate read: its facts, the phone's name null for a held build, which FUS is not asked about again. */
export type ReadFirmware = Candidate & Omit<FirmwareFacts, "name"> & { readonly name: string | null };

/** Each model read, released on the earliest build day seen, and the names FUS gave. */
export function galaxyDevices(read: readonly ReadFirmware[]): {
	readonly records: ListedDevice[];
	readonly names: Array<Pick<Label, "code" | "value">>;
} {
	const models = new Map<string, Pick<ReadFirmware, "released" | "name">>();
	for (const r of read) {
		const m = models.get(r.model);
		models.set(r.model, {
			released: m === undefined || r.released < m.released ? r.released : m.released,
			name: m?.name ?? r.name,
		});
	}
	return {
		records: [...models].map(([code, m]) => ({
			code,
			platform: "samsung",
			released: m.released,
			boards: [],
		})),
		names: [...models].flatMap(([code, m]) => (m.name === null ? [] : [{ code, value: m.name }])),
	};
}

type Majored = Pick<Candidate, "line"> & { readonly major: number };

/** The firmware in scope: for each of the newest `majors` majors, that major's on each family's newest generation that has it. */
export function scopedGalaxy<F extends Majored>(scope: Scope, read: readonly F[]): F[] {
	return [...new Set(read.map((f) => f.major))]
		.toSorted((a, b) => b - a)
		.slice(0, scope.samsung.majors)
		.flatMap((major) =>
			[
				...Map.groupBy(
					read.filter((f) => f.major === major),
					(f) => f.line.family,
				).values(),
			].flatMap((ofFamily) => {
				const newest = Math.max(...ofFamily.map((f) => f.line.generation));
				return ofFamily.filter((f) => f.line.generation === newest);
			}),
		);
}

/** Of firmware ordered oldest first, each major's newest `scope.samsung.builds`. */
function newestOfMajors<F extends { readonly major: number }>(scope: Scope, oldestFirst: readonly F[]): F[] {
	const { builds } = scope.samsung;
	if (builds === "all") return [...oldestFirst];
	const kept = new Set(
		[...Map.groupBy(oldestFirst, (f) => f.major).values()].flatMap((ofMajor) => ofMajor.slice(-builds)),
	);
	return oldestFirst.filter((f) => kept.has(f));
}

type Dated = Candidate & Pick<FirmwareFacts, "major" | "released">;

/** By FUS's build day; on one day the year letters agree, so the tails order. */
const oldestFirst = (a: Dated, b: Dated): number =>
	compareUtf8(a.released, b.released) || compareUtf8(a.build.slice(-3), b.build.slice(-3));

/** The scoped majors' newest build per model and package (each major's newest `scope.samsung.builds` of them), not held, oldest first. */
export function planGalaxy(scope: Scope, read: readonly Dated[], held: ReadonlySet<string>): GalaxyBuild[] {
	const wanted = scopedGalaxy(scope, read);
	const builds = [...Map.groupBy(wanted, (r) => `${packageLine(r.build)} ${r.major}`).values()]
		.flatMap((bs) => bs.toSorted(oldestFirst).slice(-1))
		.toSorted(oldestFirst)
		.map(({ model, region, version, build, major }) => ({ model, region, version, build, major }));
	return newestOfMajors(scope, builds).filter((b) => !held.has(b.build));
}
