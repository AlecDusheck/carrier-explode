/**
 * Reading CarrierConfig keys. A Pixel CarrierSettings file only lists what the
 * carrier changes; every other key keeps the AOSP default from
 * CarrierConfigManager. For the few keys whose default decides a feature
 * state ("VoLTE is off unless the carrier turns it on") the default is applied
 * and named as `default:<key>`, so a concept never claims the file said
 * something it did not. All other keys read as unset when absent.
 */

import type { CarrierConfigValue } from "#lib/decode/android/types.ts";
import { toJson } from "../json.ts";
import type { Json, NativeRef } from "../types.ts";

/**
 * AOSP CarrierConfigManager defaults (Android 16 sDefaults), only for keys a
 * reader falls back on. Each is a documented default, not an observed one.
 */
export const AOSP_DEFAULTS = {
  carrier_volte_available_bool: false,
  carrier_wfc_ims_available_bool: false,
  carrier_vt_available_bool: false,
  carrier_default_wfc_ims_enabled_bool: false,
  carrier_default_wfc_ims_mode_int: 2,
  carrier_default_wfc_ims_roaming_mode_int: 2,
  carrier_default_wfc_ims_roaming_enabled_bool: false,
  enhanced_4g_lte_on_by_default_bool: true,
  editable_enhanced_4g_lte_bool: true,
  hide_enhanced_4g_lte_bool: false,
  carrier_nr_availabilities_int_array: [1, 2],
  vonr_enabled_bool: false,
  vonr_on_by_default_bool: true,
  vonr_setting_visibility_bool: true,
  satellite_attach_supported_bool: false,
  vvm_type_string: "",
  carrier_supports_ss_over_ut_bool: false,
  carrier_ussd_method_int: 0,
  rtt_supported_bool: false,
  show_4g_for_lte_data_icon_bool: false,
  carrier_default_data_roaming_enabled_bool: false,
} satisfies Readonly<Record<string, Json>>;

export type DefaultedKey = keyof typeof AOSP_DEFAULTS;

/** A config value as plain Json; bundles become objects of their unwrapped members. */
export function unwrap(v: CarrierConfigValue): Json {
  switch (v.type) {
    case "text":
    case "int":
    case "bool":
    case "double":
    case "long":
      return v.value;
    case "text_array":
    case "int_array":
      return [...v.value];
    case "bundle":
      return Object.fromEntries(Object.entries(v.value).map(([k, x]) => [k, unwrap(x)]));
  }
}

export interface ConfigRead {
  readonly value: Json;
  readonly ref: NativeRef;
}

export type Configs = Readonly<Record<string, CarrierConfigValue>>;

/** The file's value for `key`, or undefined. */
export function config(configs: Configs, key: string): ConfigRead | undefined {
  const v = configs[key];
  if (v === undefined) return undefined;
  const value = unwrap(v);
  return { value, ref: { path: `config:${key}`, value } };
}

/** The file's value, else the AOSP default (named `default:<key>`). */
export function configOrDefault(configs: Configs, key: DefaultedKey): ConfigRead {
  const own = config(configs, key);
  if (own) return own;
  // A copy: the table is shared and profiles are handed to callers.
  const value = toJson(AOSP_DEFAULTS[key]) ?? null;
  return { value, ref: { path: `default:${key}`, value } };
}
