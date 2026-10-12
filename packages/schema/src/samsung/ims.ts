/**
 * A pack's IMS operator as its files' value trees and their raw leaves, and read back from them: its own entries under IMS_OPERATOR, the IMS service's
 * defaults under theirs. Only phone states read the defaults under the entries.
 */

import type { ImsOperator } from "@carrier-explode/decode-samsung";
import type { Json, NativeRef, Profile } from "../types.ts";

const MNO = "mnomap.json:mnoname";
const SWITCHES = "imsswitch.json";
const PROFILES = "imsprofile.json";
const SETTINGS = "globalsettings.json";
const DEFAULT_SWITCHES = "defaultswitch";
const DEFAULT_SETTINGS = "defaultsetting";

/** Where an operator's entries sit in each IMS file, whatever its name (mnomap.json:mnoname): so one key scans across packs. */
const IMS_OPERATOR = "operator";

type ImsRecord = ImsOperator["switches"];
type ImsTree = Readonly<Record<string, ImsRecord | readonly ImsRecord[]>>;

/** The operator's IMS files as value trees, by file name. */
export const imsTrees = (ims: ImsOperator): Readonly<Record<string, ImsTree>> => ({
	[SWITCHES]: { [IMS_OPERATOR]: ims.switches, [DEFAULT_SWITCHES]: ims.defaults.switches },
	[PROFILES]: { [IMS_OPERATOR]: ims.profile === null ? [] : [ims.profile] },
	[SETTINGS]: { [IMS_OPERATOR]: ims.settings, [DEFAULT_SETTINGS]: ims.defaults.settings },
});

const SWITCH = `${SWITCHES}:${IMS_OPERATOR}.`;
const PROFILE = `${PROFILES}:${IMS_OPERATOR}[0].`;
const SETTING = `${SETTINGS}:${IMS_OPERATOR}.`;
const DEFAULT_SWITCH = `${SWITCHES}:${DEFAULT_SWITCHES}.`;
const DEFAULT_SETTING = `${SETTINGS}:${DEFAULT_SETTINGS}.`;

const leaf = (v: unknown): Json =>
	v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
		? v
		: JSON.stringify(v);

const leavesAt = (prefix: string, record: Readonly<Record<string, unknown>>): Array<[string, Json]> =>
	Object.entries(record).map(([k, v]) => [`${prefix}${k}`, leaf(v)]);

const isList = (v: ImsRecord | readonly ImsRecord[]): v is readonly ImsRecord[] => Array.isArray(v);

/** The trees' leaves, `<file>:<key>.<name>`, a list's records indexed: the operator's own, or the defaults. */
const treeLeaves = (ims: ImsOperator, own: boolean): Array<[string, Json]> =>
	Object.entries(imsTrees(ims)).flatMap(([file, tree]) =>
		Object.entries(tree)
			.filter(([key]) => (key === IMS_OPERATOR) === own)
			.flatMap(([key, value]) =>
				isList(value)
					? value.flatMap((r, i) => leavesAt(`${file}:${key}[${i}].`, r))
					: leavesAt(`${file}:${key}.`, value),
			),
	);

export function imsLeaves(ims: ImsOperator): Record<string, Json> {
	return Object.fromEntries([[MNO, ims.mno], ...treeLeaves(ims, true), ...treeLeaves(ims, false)]);
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
