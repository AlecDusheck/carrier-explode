/**
 * A pack's IMS operator as raw leaves, and read back from them: its own entries under IMS_OPERATOR, the IMS service's
 * defaults under theirs. Only phone states read the defaults under the entries.
 */

import type { ImsOperator } from "@carrier-explode/decode-samsung";
import type { Json, NativeRef, Profile } from "../types.ts";

const MNO = "mnomap.json:mnoname";
const DEFAULT_SWITCH = "imsswitch.json:defaultswitch.";
const DEFAULT_SETTING = "globalsettings.json:defaultsetting.";

/** Where an operator's entries sit in each IMS file, whatever its name (mnomap.json:mnoname): so one key scans across packs. */
export const IMS_OPERATOR = "operator";

const SWITCH = `imsswitch.json:${IMS_OPERATOR}.`;
const PROFILE = `imsprofile.json:${IMS_OPERATOR}[0].`;
const SETTING = `globalsettings.json:${IMS_OPERATOR}.`;

const leaf = (v: unknown): Json =>
	v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
		? v
		: JSON.stringify(v);

const leavesAt = (prefix: string, record: Readonly<Record<string, unknown>>): Array<[string, Json]> =>
	Object.entries(record).map(([k, v]) => [`${prefix}${k}`, leaf(v)]);

export function imsLeaves(ims: ImsOperator | null): Record<string, Json> {
	if (ims === null) return {};
	return Object.fromEntries([
		[MNO, ims.mno],
		...leavesAt(SWITCH, ims.switches),
		...leavesAt(PROFILE, ims.profile ?? {}),
		...leavesAt(SETTING, ims.settings),
		...leavesAt(DEFAULT_SWITCH, ims.defaults.switches),
		...leavesAt(DEFAULT_SETTING, ims.defaults.settings),
	]);
}

/** One IMS value with where it is set; undefined where nothing sets it. */
type ImsLookup = (key: string) => NativeRef | undefined;

/** The operator's imsswitch.json switches, first imsprofile.json profile and globalsettings.json settings. */
export interface ImsView {
	readonly switch: ImsLookup;
	readonly profile: ImsLookup;
	readonly setting: ImsLookup;
}

type Raw = Profile["raw"];

const at =
	(raw: Raw, prefix: string): ImsLookup =>
	(key) => {
		const path = `${prefix}${key}`;
		const value = raw[path];
		return value === undefined ? undefined : { path, value };
	};

/** The operator's own entries; null without an operator. */
export function ownIms(raw: Raw): ImsView | null {
	if (typeof raw[MNO] !== "string") return null;
	return { switch: at(raw, SWITCH), profile: at(raw, PROFILE), setting: at(raw, SETTING) };
}

/** The operator's entries over the IMS service's defaults; null without an operator. */
export function layeredIms(raw: Raw): ImsView | null {
	const own = ownIms(raw);
	if (own === null) return null;
	const switches = at(raw, DEFAULT_SWITCH);
	const settings = at(raw, DEFAULT_SETTING);
	return {
		switch: (k) => own.switch(k) ?? switches(k),
		profile: own.profile,
		setting: (k) => own.setting(k) ?? settings(k),
	};
}

export const isImsDefault = (ref: NativeRef): boolean =>
	ref.path.startsWith(DEFAULT_SWITCH) || ref.path.startsWith(DEFAULT_SETTING);
