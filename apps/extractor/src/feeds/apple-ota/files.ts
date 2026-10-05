/** files.json bookkeeping, pure: one OtaFile per stored URL, with a listing per manifest entry that names it. */

import { publishedOn, type BundleRef, type ManifestTables } from "@carrier-explode/decode-ios";
import {
  sourceKey,
  type ApplePlatform, type Digests, type OtaFile, type OtaListing,
} from "@carrier-explode/schema";

/** One manifest entry. */
export interface Entry {
  readonly url: string;
  readonly version: string;
  readonly digests: Digests;
  readonly listing: Pick<OtaListing, "source" | "os" | "model">;
}

/** ByProductType "iPad" entries are ipados and CarrierBundles.Watch entries watchos; the rest, single iPhone models included, ios. */
function platformOf(r: BundleRef): ApplePlatform {
  if (r.productType?.startsWith("iPad")) return "ipados";
  if (r.family === "Watch") return "watchos";
  return "ios";
}

const digestsOf = (r: BundleRef): Digests => ({
  ...(r.digest !== undefined ? { sha1: r.digest } : {}),
  ...(r.digest3 !== undefined ? { sha384: r.digest3 } : {}),
});

/** Every carrier and country bundle entry the manifest lists. */
export function manifestEntries(tables: ManifestTables): Entry[] {
  const carriers = Object.entries(tables.refs).flatMap(([name, refs]) => refs.map((r): Entry => {
    const model = r.productType?.includes(",") ? r.productType : undefined;
    return {
      url: r.url,
      version: r.build,
      digests: digestsOf(r),
      listing: { source: sourceKey({ platform: platformOf(r), kind: "carrier", name }), os: r.os, ...(model !== undefined ? { model } : {}) },
    };
  }));
  const countries = tables.index.countries.map((c): Entry => ({
    url: c.url,
    version: c.version,
    digests: {},
    listing: { source: sourceKey({ platform: c.family === "Watch" ? "watchos" : "ios", kind: "country", name: c.id }), os: c.minOS ?? null },
  }));
  return [...carriers, ...countries];
}

/** Both digests Apple states for a URL; listings that omit one are filled by those that give it. */
function mergeDigests(url: string, a: Digests, b: Digests): Digests {
  for (const alg of ["sha1", "sha384"] as const) {
    const x = a[alg];
    const y = b[alg];
    if (x !== undefined && y !== undefined && x !== y) throw new Error(`${url}: the manifest gives two ${alg} digests`);
  }
  return { ...a, ...b };
}

const listingId = (l: Pick<OtaListing, "source" | "os" | "model">): string => [l.source, l.os ?? "", l.model ?? ""].join("|");

export interface Merged {
  readonly files: OtaFile[];
  /** A listing appeared, or left or rejoined the manifest. A new lastSeenAt alone is no change. */
  readonly changed: boolean;
}

/** A downloaded file: its bytes' sha256 and the bundle's content id. */
export interface StoredFile {
  readonly sha: string;
  readonly cid: string;
}

/** The manifest's entries merged into files.json; a URL not held before is added once `stored` has it. */
export function mergeFiles(previous: readonly OtaFile[], entries: readonly Entry[], stored: ReadonlyMap<string, StoredFile>, now: string): Merged {
  const byUrl = new Map<string, Entry[]>();
  for (const e of entries) byUrl.set(e.url, [...(byUrl.get(e.url) ?? []), e]);
  let changed = false;

  const files = previous.map((file): OtaFile => {
    const current = byUrl.get(file.url) ?? [];
    byUrl.delete(file.url);
    const listed = new Map(current.map((e) => [listingId(e.listing), e.listing]));
    const seen = (l: OtaListing): OtaListing => {
      const live = listed.delete(listingId(l));
      changed ||= live !== l.live;
      return live ? { ...l, lastSeenAt: now, live } : { ...l, live };
    };
    const [first, ...rest] = file.listings;
    const kept: OtaFile["listings"] = [seen(first), ...rest.map(seen)];
    const added = [...listed.values()].map((l): OtaListing => ({ ...l, firstSeenAt: now, lastSeenAt: now, live: true }));
    changed ||= added.length > 0;
    const digests = current.reduce((d, e) => mergeDigests(file.url, d, e.digests), file.digests);
    return { ...file, digests, listings: [...kept, ...added] };
  });

  const fresh = (e: Entry): OtaListing => ({ ...e.listing, firstSeenAt: now, lastSeenAt: now, live: true });
  for (const [url, [head, ...more]] of byUrl) {
    const got = stored.get(url);
    if (head === undefined || got === undefined) continue;
    changed = true;
    const published = publishedOn(url);
    files.push({
      url,
      version: head.version,
      ...(published !== undefined ? { published } : {}),
      digests: more.reduce((d, e) => mergeDigests(url, d, e.digests), head.digests),
      sha: got.sha,
      cid: got.cid,
      listings: [fresh(head), ...more.map(fresh)],
    });
  }
  files.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  return { files, changed };
}
