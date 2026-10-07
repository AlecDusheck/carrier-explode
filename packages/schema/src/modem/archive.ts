/** Reading an `android.modem-config` archive's members: the native files of one configuration, plus the extractor's JSON. */

import * as v from "valibot";

import { errorMessage } from "@carrier-explode/binary";

import { PROFILE_SCHEMA, type ModemConfig } from "../types.ts";
import type { ComboSource } from "./combos.ts";

export type ArchiveFiles = ReadonlyMap<string, Uint8Array>;

export function member(files: ArchiveFiles, name: string): Uint8Array {
	const bytes = files.get(name);
	if (bytes === undefined) throw new Error(`modem-config archive: no ${name}`);
	return bytes;
}

export function jsonMember<S extends v.GenericSchema>(
	files: ArchiveFiles,
	name: string,
	schema: S,
): v.InferOutput<S> {
	return v.parse(schema, JSON.parse(new TextDecoder().decode(member(files, name))));
}

export const modemConfigOf = (fields: Omit<ModemConfig, "schema">): ModemConfig => ({
	schema: PROFILE_SCHEMA,
	...fields,
});

/** A config as a family maps it, its combinations still lists: modemConfig keys them and stores them apart. */
export type ConfigDraft = Omit<ModemConfig, "schema" | "base" | "combos"> & {
	readonly combos: readonly ComboSource[];
};

/** What a family's mapper gives: the config, and the firmware's base layers under it where the family layers configs. */
export interface MappedConfig {
	readonly config: ConfigDraft;
	/** Its sha is its content's, so every config on the same base names one. */
	readonly base: Omit<ConfigDraft, "sha"> | null;
}

/** What `read` returns, or `fallback` with the failure added to `errors`: one bad member leaves the rest of the config readable. */
export function readOr<T>(errors: string[], name: string, fallback: T, read: () => T): T {
	try {
		return read();
	} catch (e) {
		errors.push(`${name}: ${errorMessage(e)}`);
		return fallback;
	}
}
