/** Phones as people buy them: a platform's devices grouped into one phone each, every device a variant told apart by its data. */

import { countryName } from "./countries.ts";
import type { NamedDevice } from "./devices.ts";
import type { ReleasePlatform } from "./types.ts";

/** What the index knows that tells a device from its siblings: the countries of the carriers it reads, its newest modem. */
export interface DeviceCoverage {
	readonly device: string;
	readonly countries: readonly string[];
	readonly modem: string | null;
}

export interface PhoneVariant {
	readonly code: string;
	/** What sets it apart from its siblings; null when only its code does. */
	readonly descriptor: string | null;
	readonly countries: readonly string[];
}

export interface PhoneModel {
	readonly key: string;
	readonly name: string;
	/** By code. */
	readonly variants: readonly PhoneVariant[];
}

/** A name's trailing `(…)` and what it says: `iPhone 18 Pro Max (US)`, `Galaxy S26 (SM-S942U)`. */
const BRACKET = /\s*\(([^()]*)\)$/;

const bare = (name: string): string => name.replace(BRACKET, "");
const bracketOf = (name: string): string | null => BRACKET.exec(name)?.[1] ?? null;

/** Samsung's model number less its region and carrier letters: SM-S948U and SM-S948U1 are both SM-S948. */
const MODEL_STEM = /^SM-[A-Z]\d{3}/;

/** One country or two by name, more by count. */
function countriesText(isos: readonly string[]): string | null {
	if (isos.length === 0) return null;
	if (isos.length > 2) return `${isos.length} countries`;
	return isos.map((iso) => countryName(iso) ?? iso.toUpperCase()).join(", ");
}

interface PhoneRule {
	readonly key: (d: NamedDevice) => string;
	/** A phone of several devices' name, from its first; a phone of one keeps that one's name. */
	readonly name: (first: NamedDevice) => string;
	/** What may tell a variant apart, field by field; only fields its siblings differ in are shown. */
	readonly fields: (d: NamedDevice, c: DeviceCoverage | undefined) => ReadonlyArray<string | null>;
}

/** An iPhone's or Pixel's variants share a name but for a bracket, and a launch day. */
const byLabel: PhoneRule = {
	key: (d) => `${bare(d.name)}\u0000${d.released}`,
	name: (first) => bare(first.name),
	fields: (d, c) => [bracketOf(d.name), c?.modem ?? null],
};

/** A Galaxy's variants share a model stem; its feed's names carry the full model number. */
const byModelNumber: PhoneRule = {
	key: (d) => MODEL_STEM.exec(d.code)?.[0] ?? d.code,
	name: (first) =>
		first.name === first.code ? (MODEL_STEM.exec(first.code)?.[0] ?? first.code) : bare(first.name),
	fields: (_, c) => [countriesText(c?.countries ?? [])],
};

const PHONE_RULES = {
	ios: byLabel,
	android: byLabel,
	samsung: byModelNumber,
} as const satisfies Record<ReleasePlatform, PhoneRule>;

const byCode = (a: NamedDevice, b: NamedDevice): number =>
	a.code.localeCompare(b.code, "en", { numeric: true });

/** `devices` grouped into phones, in the order of each phone's first device. */
export function phonesOf(
	platform: ReleasePlatform,
	devices: readonly NamedDevice[],
	coverage: readonly DeviceCoverage[],
): PhoneModel[] {
	const rule = PHONE_RULES[platform];
	const covered = new Map(coverage.map((c) => [c.device, c]));
	const groups = Map.groupBy(devices, rule.key);
	return [...groups].flatMap(([key, group]) => {
		const members = group.toSorted(byCode);
		const [first] = members;
		if (first === undefined) return [];
		const fields = members.map((d) => rule.fields(d, covered.get(d.code)));
		const differing = (i: number): boolean => new Set(fields.map((f) => f[i] ?? null)).size > 1;
		return [
			{
				key,
				name: members.length === 1 ? first.name : rule.name(first),
				variants: members.map((d, n) => ({
					code: d.code,
					descriptor:
						(fields[n] ?? []).filter((f, i): f is string => f !== null && differing(i)).join(", ") || null,
					countries: covered.get(d.code)?.countries ?? [],
				})),
			},
		];
	});
}
