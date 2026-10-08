/** Android CarrierSettings -> Profile. No variants: Android's MVNOs and device generations are separate files. */

import type { CarrierConfigValue, CarrierSettings } from "@carrier-explode/decode-android";
import { toJson } from "../json.ts";
import { PROFILE_SCHEMA, type Json, type Profile, type SourceRef } from "../types.ts";
import { text } from "../values.ts";
import { androidApns } from "./apns.ts";
import { CONFIG_PREFIX, fileConfig, unwrap } from "./config.ts";
import { androidDisplay, androidIso } from "./names.ts";
import { androidConcepts } from "./readers.ts";

/** `config:<key>` per key; bundles open into `config:<key>.<member>`, typed arrays stay one value as CarrierConfig treats them. */
function configLeaves(
	configs: Readonly<Record<string, CarrierConfigValue>>,
	prefix: string,
	out: Record<string, Json>,
): void {
	for (const [k, v] of Object.entries(configs)) {
		if (v.kind === "bundle") configLeaves(v.value, `${prefix}${k}.`, out);
		else out[`${prefix}${k}`] = unwrap(v);
	}
}

/** Every native leaf: configs, APN fields by proto name, vendor blobs (base64), fields the decoder could not name. */
function rawOf(cs: CarrierSettings): Record<string, Json> {
	const out: Record<string, Json> = {};
	configLeaves(cs.configs, CONFIG_PREFIX, out);
	cs.apns.forEach((item, i) => {
		for (const [field, v] of Object.entries(item)) {
			const j = toJson(v);
			if (j !== undefined) out[`apns[${i}].${field}`] = j;
		}
	});
	for (const v of cs.vendorConfigs) out[`vendor:${v.name}`] = v.value ?? null;
	for (const u of cs.unknown) out[`unknown:${u.path}#${u.field}`] = u.value;
	return out;
}

/** The file states no SIM rules: a Pixel's carrier_list.pb routes SIMs to it, as Apple's manifest does to a bundle. */
export function androidProfile(cs: CarrierSettings, source: SourceRef, sha: string): Profile {
	const apns = androidApns(cs.apns);
	const nameSetting = cs.configs.carrier_name_string;
	const carrierName = nameSetting?.kind === "text" ? text(nameSetting.value) : undefined;
	const raw = rawOf(cs);
	return {
		schema: PROFILE_SCHEMA,
		source,
		sha,
		identity: { display: androidDisplay(source.name, carrierName), iso: androidIso(source.name), sims: [] },
		apns,
		concepts: androidConcepts({ config: fileConfig(raw), apns }),
		raw,
		variants: [],
	};
}
