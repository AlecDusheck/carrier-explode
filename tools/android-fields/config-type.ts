/** A config key's value type, from its name's suffix or its default's setter. */

import type { ConfigType } from "../../src/lib/decode/android/index.ts";

/** Key-name suffix -> type. Longer suffixes first: `_int_array` must win over a shorter tail match. */
const SUFFIXES = [
  ["_persistable_bundle", "bundle"],
  ["_string_array", "string_array"],
  ["_long_array", "long_array"],
  ["_bool_array", "bool_array"],
  ["_int_array", "int_array"],
  ["_strings", "string_array"],
  ["_bundle", "bundle"],
  ["_string", "string"],
  ["_double", "double"],
  ["_bool", "bool"],
  ["_long", "long"],
  ["_int", "int"],
] as const satisfies ReadonlyArray<readonly [string, ConfigType]>;

/** PersistableBundle setter name (`putBoolean` -> `Boolean`) -> type. */
const SETTERS = {
  Boolean: "bool", Int: "int", Long: "long", Double: "double", String: "string",
  IntArray: "int_array", LongArray: "long_array", BooleanArray: "bool_array", StringArray: "string_array",
  PersistableBundle: "bundle",
} as const satisfies Readonly<Record<string, ConfigType>>;

export function typeBySuffix(key: string): ConfigType | undefined {
  return SUFFIXES.find(([suffix]) => key.endsWith(suffix))?.[1];
}

export function typeBySetter(setter: string): ConfigType | undefined {
  return Object.hasOwn(SETTERS, setter) ? SETTERS[setter as keyof typeof SETTERS] : undefined;
}
