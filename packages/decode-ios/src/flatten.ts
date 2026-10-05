/** Leaf-path view of decoded values: `apns[0].type-mask` → 3. Used for cross-bundle lookups; values' lookupAll reads it. */

import type { Flat } from "@carrier-explode/values";
import { decodeFile, decodedPlist, type OpenedBundle } from "./bundle.ts";
import { comparable } from "./compare.ts";
import { isJsonDict } from "./plist.ts";

/** Leaves only; tagged scalars (data, dates, big integers, UIDs) are leaves, and empty containers are kept so they stay visible. */
export function flatten(value: unknown, prefix = "", out: Flat = {}): Flat {
  if (Array.isArray(value)) {
    if (!value.length) out[prefix] = [];
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (isJsonDict(value)) {
    const keys = Object.keys(value);
    if (!keys.length && prefix) out[prefix] = {};
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = value;
  }
  return out;
}

/** Every decodable member of a bundle, flattened, keyed by member path. */
export function flattenBundle(b: OpenedBundle): Record<string, Flat> {
  const out: Record<string, Flat> = {};
  for (const f of b.info.files) {
    if (f.kind === "image" || f.kind === "binary") continue;
    // decodeFile keeps a member that does not decode, with its error, so this throws only for a path missing from the bundle.
    const d = decodeFile(b, f.path);
    // Modem override files flatten by setting name, the same view the diff uses.
    const v = d.kind === "pri-der" || d.kind === "tri-der" ? comparable(d) : decodedPlist(d);
    if (v !== undefined) out[f.path] = flatten(v);
  }
  return out;
}
