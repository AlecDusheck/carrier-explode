/**
 * Android CarrierSettings -> Profile. One file is one carrier: Android has no
 * per-device or per-MVNO overlays inside a file (its MVNOs are canonicals of
 * their own), so there are no variants.
 */

import type { CarrierConfigValue, CarrierList, CarrierSettings } from "#lib/decode/android/types.ts";
import { toJson } from "../json.ts";
import { PROFILE_SCHEMA, type Json, type Profile, type SourceRef } from "../types.ts";
import { text } from "../values.ts";
import { androidApns } from "./apns.ts";
import { unwrap } from "./config.ts";
import { androidDisplay, androidIso, listSims } from "./identity.ts";
import { androidConcepts } from "./readers.ts";

/** `config:<key>` per key; bundles open into `config:<key>.<member>`, typed arrays stay one value as CarrierConfig treats them. */
function configLeaves(configs: Readonly<Record<string, CarrierConfigValue>>, prefix: string, out: Record<string, Json>): void {
  for (const [k, v] of Object.entries(configs)) {
    if (v.type === "bundle") configLeaves(v.value, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = unwrap(v);
  }
}

/**
 * Every native leaf: configs, each APN field under its proto name, vendor
 * blobs (base64), and fields the decoder could not name, so nothing in the
 * file goes unseen in a raw diff.
 */
function rawOf(cs: CarrierSettings): Record<string, Json> {
  const out: Record<string, Json> = {};
  configLeaves(cs.configs, "config:", out);
  cs.apns.forEach((item, i) => {
    for (const [field, v] of Object.entries(item)) {
      const j = toJson(v);
      if (j !== undefined) out[`apns[${i}].${field}`] = j;
    }
  });
  for (const v of cs.vendorConfigs) out[`vendor:${v.name}`] = v.value ?? null;
  for (const u of cs.unknown ?? []) out[`unknown:${u.path}#${u.field}`] = u.value;
  return out;
}

export function androidProfile(cs: CarrierSettings, source: SourceRef, sha: string, list?: CarrierList): Profile {
  const sims = list ? listSims(list, cs.canonicalName) : [];
  const apns = androidApns(cs.apns);
  const nameSetting = cs.configs.carrier_name_string;
  const carrierName = nameSetting?.type === "text" ? text(nameSetting.value) : undefined;
  return {
    schema: PROFILE_SCHEMA,
    source,
    sha,
    version: cs.version ?? "",
    identity: { display: androidDisplay(cs.canonicalName, carrierName), iso: androidIso(cs.canonicalName, sims), sims },
    apns,
    concepts: androidConcepts({ configs: cs.configs, apns }),
    raw: rawOf(cs),
    variants: [],
  };
}
