/** Orderings Apple's numbering needs: iOS and bundle versions with betas, and iPhone product types by generation. */

import { compareDotted } from "@carrier-explode/values";

// "27.2 beta 3", "26.0 RC 2": the suffix AppleDB and Apple's release notes use.
const PRERELEASE = /^(.*?)\s+(beta|rc)\s*(\d*)$/i;

/** A prerelease ranks below its release: 27.2 beta 3 < 27.2 RC < 27.2 < 27.2.1. */
function split(v: string): [string, number] {
	const m = PRERELEASE.exec(v);
	if (!m) return [v, 1e6];
	const [, base = "", kind = "", n = ""] = m;
	return [base, kind.toLowerCase() === "rc" ? 1e3 + Number(n || 0) : Number(n || 0)];
}

export function compareVersions(a: string, b: string): number {
	const [x, ra] = split(a),
		[y, rb] = split(b);
	return compareDotted(x, y) || ra - rb;
}

export const isPrerelease = (version: string): boolean => PRERELEASE.test(version);

/** "iPhone18,1" -> [18, 1]; anything else -> [0, 0]. */
function model(id: string): [number, number] {
	const m = /(\d+),(\d+)$/.exec(id);
	return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** Product types by generation, then by model within it: iPhone17,1 < iPhone17,5 < iPhone18,1. */
export function compareProducts(a: string, b: string): number {
	const [x, y] = [model(a), model(b)];
	return x[0] - y[0] || x[1] - y[1];
}

/** Anything that serves a set of phones: a modem package, a group of override files. */
export interface ServesPhones {
	readonly devices: ReadonlyArray<{ readonly code: string }>;
}

/** The newest of some product types, by compareProducts. */
export const newestProduct = (ids: readonly string[]): string | undefined =>
	[...ids].toSorted(compareProducts).at(-1);

const newestOf = (m: ServesPhones): string => newestProduct(m.devices.map((d) => d.code)) ?? "";

/** The ones serving the newest phone first. */
export const byNewest = <M extends ServesPhones>(items: readonly M[]): M[] =>
	[...items].toSorted((a, b) => compareProducts(newestOf(b), newestOf(a)));
