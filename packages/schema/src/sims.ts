/** SimMatcher normalisation, so both platforms' spellings of one rule give one matcherKey. */

import { isMccMnc, matcherKey, ruleKey, type SimMatcher, type SimRule } from "./types.ts";

/** GID files are FF-padded (3GPP TS 31.102), so trailing FF bytes go; an all-FF GID is no rule at all. */
export function normaliseGid(raw: string): string | undefined {
	let hex = raw.trim().toUpperCase();
	if (!/^[0-9A-F]+$/.test(hex)) return hex || undefined;
	while (hex.length % 2 === 0 && hex.endsWith("FF")) hex = hex.slice(0, -2);
	return hex || undefined;
}

/** Build a SimMatcher with only the present fields, normalised. Undefined when mccmnc is malformed. */
export function simMatcher(
	fields: Pick<SimMatcher, "mccmnc"> & {
		readonly [K in Exclude<keyof SimMatcher, "mccmnc">]?: SimMatcher[K] | undefined;
	},
): SimMatcher | undefined {
	const mccmnc = fields.mccmnc.trim();
	if (!isMccMnc(mccmnc)) return undefined;
	const gid1 = fields.gid1 === undefined ? undefined : normaliseGid(fields.gid1);
	const gid2 = fields.gid2 === undefined ? undefined : normaliseGid(fields.gid2);
	// SPN comparisons on the phone are case-insensitive (CarrierResolver), so the key is too.
	const spn = fields.spn?.trim().toUpperCase() || undefined;
	const imsiPrefix = fields.imsiPrefix?.trim() || undefined;
	const iccidPrefix = fields.iccidPrefix?.trim() || undefined;
	return {
		mccmnc,
		...(gid1 !== undefined ? { gid1 } : {}),
		...(gid2 !== undefined ? { gid2 } : {}),
		...(spn !== undefined ? { spn } : {}),
		...(imsiPrefix !== undefined ? { imsiPrefix } : {}),
		...(iccidPrefix !== undefined ? { iccidPrefix } : {}),
	};
}

const firstPerKey = <T>(xs: Iterable<T>, key: (x: T) => string): T[] => {
	const byKey = new Map<string, T>();
	for (const x of xs) if (!byKey.has(key(x))) byKey.set(key(x), x);
	return [...byKey.values()];
};

/** One matcher per matcherKey, the first of each. */
export const uniqueSims = (sims: Iterable<SimMatcher>): SimMatcher[] => firstPerKey(sims, matcherKey);

/** One rule per ruleKey, the first of each. */
export const uniqueRules = (rules: Iterable<SimRule>): SimRule[] => firstPerKey(rules, ruleKey);

/** What a SIM states, as someone looking it up gives it: its PLMN, and any of its group IDs, SPN, IMSI and ICCID. */
export interface SimFacts {
	readonly mccmnc: string;
	readonly gid1?: string;
	readonly gid2?: string;
	readonly spn?: string;
	readonly imsi?: string;
	readonly iccid?: string;
}

const startsWith = (stated: string | undefined, prefix: string): boolean =>
	stated !== undefined && stated.startsWith(prefix);

const gidOf = (raw: string | undefined): string | undefined =>
	raw === undefined ? undefined : normaliseGid(raw);

/** Whether a rule selects the SIM: an ICCID rule by prefix; a PLMN rule by its MCC-MNC and every qualifier it states. */
export function selectsSim(rule: SimRule, sim: SimFacts): boolean {
	switch (rule.by) {
		case "iccid":
			return startsWith(sim.iccid, rule.prefix);
		// A carrier ID is the phone's own reading of the SIM, which no SIM field states.
		case "carrierId":
			return false;
		case "plmn": {
			const r = rule.sim;
			return (
				r.mccmnc === sim.mccmnc &&
				(r.gid1 === undefined || startsWith(gidOf(sim.gid1), r.gid1)) &&
				(r.gid2 === undefined || startsWith(gidOf(sim.gid2), r.gid2)) &&
				(r.spn === undefined || sim.spn?.trim().toUpperCase() === r.spn) &&
				(r.imsiPrefix === undefined || startsWith(sim.imsi, r.imsiPrefix)) &&
				(r.iccidPrefix === undefined || startsWith(sim.iccid, r.iccidPrefix))
			);
		}
	}
}

/** How narrowly a rule selects: the qualifiers a PLMN rule adds to its MCC-MNC; an ICCID prefix counts as one. */
export const ruleSpecificity = (rule: SimRule): number =>
	rule.by === "plmn" ? Object.keys(rule.sim).length - 1 : 1;
