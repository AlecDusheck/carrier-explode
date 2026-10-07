/**
 * CarrierConfig values. A file lists only what it changes; a phone reads its carrier's file over its build's
 * default.pb over AOSP's defaults, and only phone states layer them.
 */

import * as v from "valibot";

import { configDoc, type CarrierConfigValue } from "@carrier-explode/decode-android";
import { jsonSchema } from "../records/values.ts";
import type { Json, NativeRef } from "../types.ts";

/**
 * AOSP's sDefaults that are no literal, so CONFIG_DOCS (decode-android's fields.ts, generated from
 * CarrierConfigManager.java) has no `default` for them; read from that file at android-17.0.0_r1.
 */
const COMPUTED_DEFAULTS: Readonly<Record<string, Json>> = {
	// new int[]{CARRIER_NR_AVAILABILITY_NSA, CARRIER_NR_AVAILABILITY_SA}: 1, 2.
	carrier_nr_availabilities_int_array: [1, 2],
	// PersistableBundle.EMPTY.
	carrier_supported_satellite_services_per_provider_bundle: {},
	// USSD_OVER_CS_PREFERRED.
	carrier_ussd_method_int: 0,
	// ImsVoice.getDefaults(): AMR-WB 97, 98; AMR-NB 99, 100; DTMF WB 101; DTMF NB 102.
	"imsvoice.audio_codec_capability_payload_types_bundle": {
		"imsvoice.amrwb_payload_type_int_array": [97, 98],
		"imsvoice.amrnb_payload_type_int_array": [99, 100],
		"imsvoice.dtmfwb_payload_type_int_array": [101],
		"imsvoice.dtmfnb_payload_type_int_array": [102],
	},
};

/** AOSP's default for a key: its CONFIG_DOCS literal, else a computed one; undefined where AOSP sets none, null included. */
function aospDefault(key: string): Json | undefined {
	const literal = configDoc(key)?.default;
	if (literal === undefined) return COMPUTED_DEFAULTS[key];
	return v.parse(jsonSchema, JSON.parse(literal)) ?? undefined;
}

/** A config value as plain Json; bundles become objects of their unwrapped members. */
export function unwrap(c: CarrierConfigValue): Json {
	switch (c.kind) {
		case "text":
		case "int":
		case "bool":
		case "double":
		case "long":
			return c.value;
		case "text_array":
		case "int_array":
			return [...c.value];
		case "bundle":
			return Object.fromEntries(Object.entries(c.value).map(([k, x]) => [k, unwrap(x)]));
	}
}

export interface ConfigRead {
	readonly value: Json;
	readonly ref: NativeRef;
}

/** A key's value, or undefined where nothing sets it. */
export type ConfigLookup = (key: string) => ConfigRead | undefined;

/** What a CarrierConfig key's raw leaf is named by: `config:<key>`. */
export const CONFIG_PREFIX = "config:";

/** The file's values, from its raw `config:<key>` leaves; a bundle's members (`config:<key>.<member>`) are gathered back. */
export function fileConfig(raw: Readonly<Record<string, Json>>): ConfigLookup {
	return (key) => {
		const path = `${CONFIG_PREFIX}${key}`;
		const own = raw[path];
		if (own !== undefined) return { value: own, ref: { path, value: own } };
		const members = Object.entries(raw).flatMap(([k, leaf]) =>
			k.startsWith(`${path}.`) ? [[k.slice(path.length + 1), leaf] as const] : [],
		);
		if (members.length === 0) return undefined;
		const value: Json = Object.fromEntries(members);
		return { value, ref: { path, value } };
	};
}

/** AOSP's default, named `aosp:<key>`. */
export const aospConfig: ConfigLookup = (key) => {
	const value = aospDefault(key);
	return value === undefined ? undefined : { value, ref: { path: `aosp:${key}`, value } };
};

/** Each key from the first lookup that sets it. */
export const layered =
	(...lookups: readonly ConfigLookup[]): ConfigLookup =>
	(key) => {
		for (const lookup of lookups) {
			const read = lookup(key);
			if (read !== undefined) return read;
		}
		return undefined;
	};
