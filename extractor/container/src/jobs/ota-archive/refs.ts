/**
 * refs.json bookkeeping, pure. A ref is one manifest entry (source, OS key,
 * model, URL), so a file listed under several OS keys is several refs and one download.
 */

import { publishedOn, type BundleRef, type ManifestTables } from "../../../../../src/lib/decode/index.ts";
import { sourceKey, type Digest, type Platform } from "../../../../../src/lib/schema/index.ts";
import type { OtaRef } from "../../../../../src/lib/storage/keys.ts";

/** A ref as the manifest states it, before bookkeeping. */
export type Listed = Pick<OtaRef, "url" | "source" | "os" | "build" | "model" | "published" | "digest">;

const identity = (r: Listed): string => [r.source, r.os, r.model ?? "", r.url].join("|");

/** ByProductType "iPad" entries are ipados and CarrierBundles.Watch entries watchos; the rest, single iPhone models included, ios. */
function platformOf(productType: string | undefined): Platform {
  if (productType?.startsWith("iPad")) return "ipados";
  if (productType === "Watch") return "watchos";
  return "ios";
}

/** The stronger digest Apple gives. */
function digestOf(r: BundleRef): Digest | undefined {
  if (r.digest3 !== undefined) return { algorithm: "sha384", hex: r.digest3 };
  if (r.digest !== undefined) return { algorithm: "sha1", hex: r.digest };
  return undefined;
}

function listed(url: string, source: string, os: string, build: string, model: string | undefined, digest: Digest | undefined): Listed {
  const published = publishedOn(url);
  return {
    url, source, os, build,
    ...(model !== undefined ? { model } : {}),
    ...(published !== undefined ? { published } : {}),
    ...(digest !== undefined ? { digest } : {}),
  };
}

/** Every carrier and country bundle entry the manifest lists. */
export function listedRefs(tables: ManifestTables): Listed[] {
  const carriers = Object.entries(tables.refs).flatMap(([name, refs]) => refs.map((r) => {
    const source = sourceKey({ platform: platformOf(r.productType), kind: "carrier", name });
    const model = r.productType?.includes(",") ? r.productType : undefined;
    return listed(r.url, source, r.os, r.build, model, digestOf(r));
  }));
  const countries = tables.index.countries.map((c) => {
    const source = sourceKey({ platform: c.family === "Watch" ? "watchos" : "ios", kind: "country", name: c.id });
    return listed(c.url, source, c.minOS ?? "", c.version, undefined, undefined);
  });
  return [...carriers, ...countries];
}

export interface Merged {
  readonly refs: OtaRef[];
  /** A ref appeared, or left or rejoined the manifest. A new lastSeen alone is no change. */
  readonly changed: boolean;
}

export function mergeRefs(previous: readonly OtaRef[], current: readonly Listed[], now: string): Merged {
  const live = new Map(current.map((l) => [identity(l), l]));
  let changed = false;
  const refs: OtaRef[] = previous.map((p) => {
    const l = live.get(identity(p));
    live.delete(identity(p));
    if (!l) {
      changed ||= p.live;
      return { ...p, live: false };
    }
    changed ||= !p.live;
    return { ...l, archive: p.archive, firstSeen: p.firstSeen, lastSeen: now, live: true };
  });
  for (const l of live.values()) {
    changed = true;
    refs.push({ ...l, archive: { state: "pending" }, firstSeen: now, lastSeen: now, live: true });
  }
  refs.sort((a, b) => (identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0));
  return { refs, changed };
}
