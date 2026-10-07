/** A phone's settings as layers (carrier.plist, its override file, an MVNO configuration), merged as CommCenter merges them; each read names the file that set it. */

import { isJsonDict, mergeSettings } from "@carrier-explode/decode-ios";
import { toJson } from "../json.ts";
import type { NativeRef } from "../types.ts";

export interface Layer {
	/** Bundle member the values live in, e.g. `carrier.plist`. */
	readonly file: string;
	/** Path of the layer's root inside that file, `` or `MVNOOverrides.Configuration_1.OverrideConfiguration.`. */
	readonly prefix: string;
	readonly dict: Readonly<Record<string, unknown>>;
}

export interface Settings {
	readonly layers: readonly Layer[];
	/** All layers merged, lowest first. */
	readonly merged: Readonly<Record<string, unknown>>;
}

export function settings(layers: readonly Layer[]): Settings {
	const merged = layers.reduce<Record<string, unknown>>((acc, l) => mergeSettings(acc, { ...l.dict }), {});
	return { layers, merged };
}

export const withLayer = (base: Settings, layer: Layer): Settings => settings([...base.layers, layer]);

/** A dotted path; keys may hold dots themselves (`com.apple.voicemail.imap`), so each step takes the longest key that exists. */
function resolve(root: unknown, dotted: string): { value: unknown; found: boolean } {
	const parts = dotted.split(".");
	let cur = root;
	let i = 0;
	while (i < parts.length) {
		if (!isJsonDict(cur)) return { value: undefined, found: false };
		const dict = cur;
		let j = parts.length;
		while (j > i && !Object.hasOwn(dict, parts.slice(i, j).join("."))) j--;
		if (j === i) return { value: undefined, found: false };
		cur = dict[parts.slice(i, j).join(".")];
		i = j;
	}
	return { value: cur, found: true };
}

/** The entries of an array, or the values of a dictionary: plists write lists both ways. */
export const members = (v: unknown): readonly unknown[] =>
	Array.isArray(v) ? v : isJsonDict(v) ? Object.values(v) : [];

export interface Read {
	readonly value: unknown;
	readonly ref: NativeRef;
}

/** The topmost layer that sets `path`. */
const origin = (s: Settings, path: string): Layer | undefined =>
	s.layers.toReversed().find((l) => resolve(l.dict, path).found);

/** The merged value at `path` and where it was set, or undefined when no layer sets it. */
export function read(s: Settings, path: string): Read | undefined {
	const hit = resolve(s.merged, path);
	// The merged tree holds only what some layer set, so a found path always has an origin.
	const from = hit.found ? origin(s, path) : undefined;
	if (!from) return undefined;
	return {
		value: hit.value,
		ref: { path: `${from.file}:${from.prefix}${path}`, value: toJson(hit.value) ?? null },
	};
}

/** An MVNOOverrides entry: the SIMs it claims and the settings those SIMs get. */
interface MvnoConfiguration {
	readonly name: string;
	readonly supportedSims: unknown;
	readonly settings: Settings;
}

export function mvnoConfigurations(s: Settings): MvnoConfiguration[] {
	const overrides = s.merged.MVNOOverrides;
	if (!isJsonDict(overrides)) return [];
	return Object.entries(overrides).flatMap(([name, entry]): MvnoConfiguration[] => {
		if (!isJsonDict(entry)) return [];
		const path = `MVNOOverrides.${name}`;
		const file = origin(s, path)?.file;
		if (file === undefined) throw new Error(`${path} has no origin layer`);
		const dict = isJsonDict(entry.OverrideConfiguration) ? entry.OverrideConfiguration : {};
		return [
			{
				name,
				supportedSims: entry.SupportedSIMs,
				settings: withLayer(s, { file, prefix: `${path}.OverrideConfiguration.`, dict }),
			},
		];
	});
}
