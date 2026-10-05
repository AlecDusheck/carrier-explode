/** What a value tree says about CarrierConfig keys: too large to ship to the browser whole, so a page sends the docs for its keys. */

import { readConfigValue, type ConfigDoc, type ConfigReading } from "@carrier-explode/decode-android";
import type { FieldDoc } from "@carrier-explode/decode-ios";
import type { TreeDocs } from "#lib/tree-docs.ts";

/** CarrierConfigManager's javadoc for a page's config keys, which sit at the tree's top or under `under` (`configs.`). */
export function androidDocs(docs: Readonly<Record<string, ConfigDoc>>, under = ""): TreeDocs {
  const field = (key: string, path: string): FieldDoc | undefined => {
    const d = path === under + key ? docs[key] : undefined;
    if (!d?.note) return undefined;
    return { note: d.since ? `${d.note} API ${d.since}+.` : d.note, ...(d.default !== undefined ? { default: d.default } : {}) };
  };
  const read = (key: string, path: string, value: unknown): ConfigReading | null => {
    if (path !== under + key) return null;
    return Object.hasOwn(docs, key) ? readConfigValue(key, value) : { kind: "not-understood", reason: "AOSP's CarrierConfigManager, QNS and IWLAN code declare no such key." };
  };
  return { field, value: () => undefined, read };
}
