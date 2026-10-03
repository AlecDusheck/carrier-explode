/**
 * feeds/ios-ota/refs.json bookkeeping, pure: what the manifest lists now,
 * merged into every ref ever seen. A ref is one manifest entry (a source, an
 * OS key, a product type, a URL), so a file Apple lists under several OS keys
 * is several refs sharing one URL, and one download.
 */

import { sourceKey, type Platform } from "../../../../../src/lib/schema/index.ts";
import type { ManifestTables } from "../../../../../src/lib/decode/index.ts";
import type { OtaRef } from "../../../../../src/lib/storage/keys.ts";

/** A ref as the manifest states it, before bookkeeping. */
export type Listed = Pick<OtaRef, "url" | "source" | "os" | "build" | "productType" | "sha1" | "sha384">;

const identity = (r: Listed): string => [r.source, r.os, r.productType ?? "", r.url].join("|");

/**
 * The platform a manifest entry is for: ByProductType "iPad" entries are
 * ipados, CarrierBundles.Watch entries watchos, and everything else, the
 * model-specific iPhone entries (iPhone7,1) included, ios.
 */
function platformOf(productType: string | undefined): Platform {
  if (productType?.startsWith("iPad")) return "ipados";
  if (productType === "Watch") return "watchos";
  return "ios";
}

/** A product type worth keeping on the ref: a single model (`iPhone7,1`), not a family the platform already says. */
const modelOf = (productType: string | undefined): string | undefined => (productType?.includes(",") ? productType : undefined);

/** Every carrier and country bundle entry the manifest lists. */
export function listedRefs(tables: ManifestTables): Listed[] {
  const out: Listed[] = [];
  for (const [name, refs] of Object.entries(tables.refs)) {
    for (const r of refs) {
      const model = modelOf(r.productType);
      out.push({
        url: r.url,
        source: sourceKey({ platform: platformOf(r.productType), kind: "carrier", name }),
        os: r.os,
        build: r.build,
        ...(model !== undefined ? { productType: model } : {}),
        ...(r.digest !== undefined ? { sha1: r.digest } : {}),
        ...(r.digest3 !== undefined ? { sha384: r.digest3 } : {}),
      });
    }
  }
  for (const c of tables.index.countries) {
    const platform = c.family === "Watch" ? "watchos" : "ios";
    out.push({ url: c.url, source: sourceKey({ platform, kind: "country", name: c.id }), os: c.minOS ?? "", build: c.version });
  }
  return out;
}

export interface Merged {
  readonly refs: OtaRef[];
  /** New refs, or refs that left (or came back to) the live manifest: what the index shows. lastSeen alone is not a change. */
  readonly changed: boolean;
}

export function mergeRefs(previous: readonly OtaRef[], listed: readonly Listed[], now: string): Merged {
  const live = new Map(listed.map((l) => [identity(l), l]));
  let changed = false;
  const refs: OtaRef[] = previous.map((p) => {
    const l = live.get(identity(p));
    live.delete(identity(p));
    if (!l) {
      if (p.live) changed = true;
      return { ...p, live: false };
    }
    if (!p.live) changed = true;
    return { ...p, ...l, live: true, lastSeen: now };
  });
  for (const l of live.values()) {
    changed = true;
    refs.push({ ...l, firstSeen: now, lastSeen: now, live: true });
  }
  refs.sort((a, b) => (identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0));
  return { refs, changed };
}
