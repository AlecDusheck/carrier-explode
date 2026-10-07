/**
 * Samsung's IMS maps, from imsservice.apk's res/raw: mnomap.json names a SIM's operator ("mnoname"); the others give
 * each operator's IMS services, registration profiles and domain settings, over the service's defaults. A pack keeps its
 * own operator's, and the defaults.
 */

import { gidHex, type OmcInfo } from "./omc-info.ts";

export const IMS_FILES = ["mnomap.json", "imsswitch.json", "imsprofile.json", "globalsettings.json"] as const;
type ImsFile = (typeof IMS_FILES)[number];

export class ImsError extends Error {
	override name = "ImsError";
}

export type ImsValue =
	| string
	| number
	| boolean
	| null
	| readonly ImsValue[]
	| { readonly [k: string]: ImsValue };
type ImsRecord = Readonly<Record<string, ImsValue>>;

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/** JSON with `//` line comments, outside strings, as Samsung writes these files. */
export function parseJsonc(text: string): unknown {
	return JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (_, s: string | undefined) => s ?? ""));
}

const isRecord = (v: unknown): v is ImsRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const records = (v: unknown, what: string): ImsRecord[] => {
	if (!Array.isArray(v) || !v.every(isRecord)) throw new ImsError(`${what} is not a list of objects`);
	return v;
};
const str = (r: ImsRecord, k: string): string => (typeof r[k] === "string" ? r[k] : "");

/** One mnomap rule: every non-empty qualifier must match. */
export interface MnoRule {
	readonly mccmnc: string;
	/** IMSI digits after the network code ("SPCode" in customer.xml). */
	readonly subset: string;
	readonly gid1: string;
	readonly gid2: string;
	readonly spname: string;
	/** `SFR_FR@BLOCKGC`: what follows `@` only steers RCS's Google cloud. */
	readonly mnoname: string;
}

/** What the service gives an operator its entries leave unset: imsswitch.json's `defaultswitch`, globalsettings.json's `defaultsetting`. */
type ImsDefaults = {
	readonly switches: ImsRecord;
	readonly settings: ImsRecord;
};

export interface ImsMaps {
	readonly rules: readonly MnoRule[];
	/** imsswitch.json's entries by mnoname. */
	readonly switches: ReadonlyMap<string, ImsRecord>;
	/** imsprofile.json's profiles by mnoname (an operator may have several: one per PDN or service). */
	readonly profiles: ReadonlyMap<string, readonly ImsRecord[]>;
	/** globalsettings.json's `globalsetting` entries by mnoname. */
	readonly settings: ReadonlyMap<string, ImsRecord>;
	readonly defaults: ImsDefaults;
}

export function readIms(files: ReadonlyMap<string, Uint8Array>): ImsMaps {
	const json = (name: ImsFile): ImsRecord => {
		const bytes = files.get(name);
		if (bytes === undefined) throw new ImsError(`the IMS service has no ${name}`);
		const doc = parseJsonc(utf8.decode(bytes));
		if (!isRecord(doc)) throw new ImsError(`${name} is not an object`);
		return doc;
	};
	const rules = records(json("mnomap.json").mnomap, "mnomap.json's mnomap").map((r): MnoRule => ({
		mccmnc: str(r, "mccmnc"),
		subset: str(r, "subset"),
		gid1: str(r, "gid1").toUpperCase(),
		gid2: str(r, "gid2").toUpperCase(),
		spname: str(r, "spname"),
		mnoname: str(r, "mnoname"),
	}));
	const sw = json("imsswitch.json");
	const switches = new Map(
		records(sw.imsswitch, "imsswitch.json's imsswitch").map((r) => [str(r, "mnoname"), r]),
	);
	const profiles = new Map<string, ImsRecord[]>();
	for (const p of records(json("imsprofile.json").profile, "imsprofile.json's profile")) {
		const mno = str(p, "mnoname");
		profiles.set(mno, [...(profiles.get(mno) ?? []), p]);
	}
	const global = json("globalsettings.json");
	const settings = new Map(
		records(global.globalsetting, "globalsettings.json's globalsetting").map((r) => [str(r, "mnoname"), r]),
	);
	const defaults = {
		switches: isRecord(sw.defaultswitch) ? sw.defaultswitch : {},
		settings: isRecord(global.defaultsetting) ? global.defaultsetting : {},
	};
	return { rules, switches, profiles, settings, defaults };
}

/** A pack's SIM rule as mnomap reads one: a qualifier it leaves out is any SIM's, whatever that SIM holds. */
export interface ImsSim {
	readonly mccmnc: string;
	readonly imsi?: string;
	readonly gid1?: string;
	readonly gid2?: string;
	readonly spn?: string;
}

/** How a map rule's qualifiers meet a SIM rule's: undefined when one they both state differs. */
function fit(r: MnoRule, sim: ImsSim): { readonly agreed: number; readonly open: number } | undefined {
	const checks = [
		[r.subset, sim.imsi, (imsi: string) => imsi.startsWith(`${sim.mccmnc}${r.subset}`)],
		[r.gid1, sim.gid1, (g: string) => g.toUpperCase().startsWith(r.gid1)],
		[r.gid2, sim.gid2, (g: string) => g.toUpperCase().startsWith(r.gid2)],
		[r.spname, sim.spn, (s: string) => s.toLowerCase() === r.spname.toLowerCase()],
	] as const;
	let agreed = 0;
	let open = 0;
	for (const [rule, stated, match] of checks) {
		if (rule === "") continue;
		if (stated === undefined) open++;
		else if (match(stated)) agreed++;
		else return undefined;
	}
	return { agreed, open };
}

/** The rule a SIM rule falls under: the one agreeing on the most qualifiers, then the one leaving the fewest open. */
export function mnoRule(maps: ImsMaps, sim: ImsSim): MnoRule | undefined {
	let best: { readonly rule: MnoRule; readonly agreed: number; readonly open: number } | undefined;
	for (const rule of maps.rules) {
		const f = rule.mccmnc === sim.mccmnc ? fit(rule, sim) : undefined;
		if (
			f !== undefined &&
			(best === undefined || f.agreed > best.agreed || (f.agreed === best.agreed && f.open < best.open))
		)
			best = { rule, ...f };
	}
	return best?.rule;
}

/** `SFR_FR@BLOCKGC` → `SFR_FR`: the operator imsswitch.json and imsprofile.json key. */
export const mnoName = (rule: MnoRule): string => rule.mnoname.split("@")[0] ?? rule.mnoname;

/** A pack's operator in the IMS service: its own entries, and the service's defaults under them. A type, so it is JSON. */
export type ImsOperator = {
	readonly mno: string;
	/** Its imsswitch.json entry. */
	readonly switches: ImsRecord;
	/** Its first imsprofile.json profile. */
	readonly profile: ImsRecord | null;
	/** Its globalsettings.json entry; empty where it has none. */
	readonly settings: ImsRecord;
	readonly defaults: ImsDefaults;
};

/** The operator most of the pack's SIM rules are, among those the IMS service has switches for. */
export function imsOperator(info: OmcInfo, maps: ImsMaps): ImsOperator | null {
	const counts = new Map<string, number>();
	for (const c of info.carriers) {
		const mccmnc = `${c.mcc}${c.mnc}`;
		const g = gidHex(c);
		const rule = mnoRule(maps, {
			mccmnc,
			...(c.subsetCode === undefined ? {} : { imsi: `${mccmnc}${c.subsetCode}` }),
			...(g === undefined ? {} : { gid1: g }),
			...(c.gid2 === undefined ? {} : { gid2: c.gid2 }),
			...(c.spn === undefined ? {} : { spn: c.spn }),
		});
		const mno = rule === undefined ? undefined : mnoName(rule);
		if (mno !== undefined && maps.switches.has(mno)) counts.set(mno, (counts.get(mno) ?? 0) + 1);
	}
	const mno = [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0];
	const switches = mno === undefined ? undefined : maps.switches.get(mno);
	return mno === undefined || switches === undefined
		? null
		: {
				mno,
				switches,
				profile: maps.profiles.get(mno)?.[0] ?? null,
				settings: maps.settings.get(mno) ?? {},
				defaults: maps.defaults,
			};
}

/** An operator as a pack stores it (PACK_FILES.ims): `null` where none of its SIMs has IMS switches. */
export function decodeImsOperator(bytes: Uint8Array): ImsOperator | null {
	const doc: unknown = JSON.parse(utf8.decode(bytes));
	if (doc === null) return null;
	const defaults = isRecord(doc) ? doc.defaults : undefined;
	if (
		!isRecord(doc) ||
		typeof doc.mno !== "string" ||
		!isRecord(doc.switches) ||
		!(doc.profile === null || isRecord(doc.profile)) ||
		!isRecord(doc.settings) ||
		!isRecord(defaults) ||
		!isRecord(defaults.switches) ||
		!isRecord(defaults.settings)
	) {
		throw new ImsError("a pack's IMS operator is not {mno, switches, profile, settings, defaults}");
	}
	return {
		mno: doc.mno,
		switches: doc.switches,
		profile: doc.profile,
		settings: doc.settings,
		defaults: { switches: defaults.switches, settings: defaults.settings },
	};
}
