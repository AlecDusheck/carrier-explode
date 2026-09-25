/**
 * The iTunes version manifest — the single acquisition entry point for every
 * carrier and country bundle Apple publishes.
 */

import { parsePlist, isPlistDict, type PlistDict, type PlistValue, bytesToHex } from "$lib/decode";
import { compareVersions, countryName, splitName, versionKey } from "$lib/names";

export { compareVersions, countryName, splitName, versionKey };

export const MANIFEST_URL =
  "https://itunes.apple.com/WebObjects/MZStore.woa/wa/com.apple.jingle.appserver.client.MZITunesClientCheck/version";

export interface BundleRef {
  /** iOS version key this entry is published under, or "legacy". */
  os: string;
  build: string;
  url: string;
  /** SHA-1 of the file, hex. Absent where the entry only carries a long digest. */
  digest?: string;
  /** SHA-384, hex. Newer entries put it under Digest3; Watch and country
   *  entries put it under the plain Digest key, so it is routed by length. */
  digest3?: string;
  /** Present for ByProductType entries (iPad, iPod, …). */
  productType?: string;
  /** "image" when the bundle came out of an iOS image rather than the asset server. */
  source?: "image" | "cdn";
}

export interface CarrierSummary {
  name: string;
  /** Country suffix pulled off the bundle name, lower-case ISO-3166 alpha-2. */
  cc?: string;
  /** Best-effort display name. */
  display: string;
  /** iOS version keys, sorted oldest → newest. */
  versions: string[];
  latestBuild?: string;
  productTypes: string[];
  hasLegacy: boolean;
  /** Build of this bundle inside the iOS image, when it ships there. */
  image?: string;
}

export interface CountrySummary {
  id: string;
  bundleId: string;
  key: string;
  version: string;
  url: string;
  minOS?: string;
  family: "iPhone" | "Watch";
  /** CountryId keys that route here: numeric MCCs and reverse-DNS ids alike. */
  countryIds: string[];
}

export interface ManifestIndex {
  fetchedAt: string;
  iTunesVersion: string;
  counts: Record<string, number>;
  carriers: CarrierSummary[];
  countries: CountrySummary[];
  /** CarrierBundles.iPhone.OtherKnownSettings and CarrierBundles.Watch. */
  otherKnown: BundleRef[];
  watchCarriers: CarrierSummary[];
}

type Dict = PlistDict;

/** `v` when it is a dictionary, else an empty one. */
const dict = (v: PlistValue | undefined): Dict => (isPlistDict(v) ? v : {});

function refFromEntry(os: string, e: Dict, productType?: string): BundleRef | null {
  const url = e.BundleURL;
  if (typeof url !== "string") return null;
  const plain = e.Digest instanceof Uint8Array ? e.Digest : undefined;
  const long = e.Digest3 instanceof Uint8Array ? e.Digest3 : undefined;
  return {
    os,
    build: typeof e.BuildVersion === "string" ? e.BuildVersion : String(e.BundleVersion ?? ""),
    url,
    digest: plain && plain.length === 20 ? bytesToHex(plain) : undefined,
    digest3: long ? bytesToHex(long) : plain && plain.length === 48 ? bytesToHex(plain) : undefined,
    productType,
  };
}

/** All published refs for one carrier name: iOS-family newest first, then Watch. */
export function carrierRefs(root: Dict, name: string): BundleRef[] {
  const out: BundleRef[] = [];
  const entry = dict(root.MobileDeviceCarrierBundlesByProductVersion)[name];
  if (isPlistDict(entry)) {
    for (const [os, v] of Object.entries(entry)) {
      if (os === "ByProductType") {
        if (!isPlistDict(v)) continue;
        for (const [pt, versions] of Object.entries(v)) {
          if (!isPlistDict(versions)) continue;
          for (const [pos, pe] of Object.entries(versions)) {
            if (isPlistDict(pe)) { const r = refFromEntry(pos, pe, pt); if (r) out.push(r); }
          }
        }
        continue;
      }
      if (isPlistDict(v)) { const r = refFromEntry(os, v); if (r) out.push(r); }
    }
  }
  const legacy = dict(root.MobileDeviceCarrierBundles)[name];
  if (isPlistDict(legacy)) {
    const r = refFromEntry("legacy", legacy);
    if (r) out.push(r);
  }
  // Watch + newer-format carrier bundles
  const cb = dict(root.CarrierBundles);
  for (const family of ["Watch", "iPhone"] as const) {
    for (const [key, v] of Object.entries(dict(dict(cb[family]).Bundles))) {
      if (!isPlistDict(v) || v.BundleID !== name) continue;
      const r = refFromEntry(String(dict(v.OS).Min ?? "") || "—", v, family);
      if (r) { r.build = String(v.BundleVersion ?? r.build); r.productType = family; r.os = `${family} ${key.split("_").pop()}`; out.push(r); }
    }
  }
  // iOS keys and Watch bundle versions are different numbering schemes, so they
  // are grouped rather than interleaved: iOS-family newest first, then Watch.
  const group = (r: BundleRef) => (r.productType === "Watch" ? 1 : 0);
  out.sort((a, b) =>
    group(a) - group(b) ||
    (group(a) === 1
      ? compareVersions(b.build, a.build)
      : compareVersions(b.os, a.os) || compareVersions(b.build, a.build)));
  return out;
}

export function buildIndex(root: Dict): ManifestIndex {
  const byVer = dict(root.MobileDeviceCarrierBundlesByProductVersion);
  const legacy = dict(root.MobileDeviceCarrierBundles);

  const names = new Set<string>();
  for (const k of Object.keys(byVer)) if (isPlistDict(byVer[k])) names.add(k);
  for (const k of Object.keys(legacy)) if (isPlistDict(legacy[k])) names.add(k);

  const carriers: CarrierSummary[] = [];
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const entry = dict(byVer[name]);
    const versions: string[] = [];
    const productTypes = new Set<string>();
    for (const [os, v] of Object.entries(entry)) {
      if (os === "ByProductType") {
        if (isPlistDict(v)) {
          for (const [pt, versions] of Object.entries(v)) {
            // { FallbackToByProductVersion: true } means "no bundles of its own".
            if (!isPlistDict(versions)) continue;
            const real = Object.values(versions).some(
              (e) => isPlistDict(e) && typeof e.BundleURL === "string",
            );
            if (real) productTypes.add(pt);
          }
        }
        continue;
      }
      if (isPlistDict(v) && typeof v.BundleURL === "string") versions.push(os);
    }
    versions.sort(compareVersions);
    const newest = versions.length ? dict(entry[versions[versions.length - 1]]) : undefined;
    const { cc, display } = splitName(name);
    carriers.push({
      name,
      cc,
      display,
      versions,
      latestBuild: newest && typeof newest.BuildVersion === "string" ? newest.BuildVersion : undefined,
      productTypes: [...productTypes].sort(),
      hasLegacy: isPlistDict(legacy[name]),
    });
  }

  // Country bundles, both families, resolved through BundleMappings + CountryId.
  const countries: CountrySummary[] = [];
  const cbRoot = dict(root.CountryBundles);
  for (const family of ["iPhone", "Watch"] as const) {
    const fam = dict(cbRoot[family]);
    const mappings = dict(fam.BundleMappings);
    const countryId = dict(fam.CountryId);

    const idsFor = new Map<string, string[]>(); // bundle key -> CountryId keys
    const minOsFor = new Map<string, string>();
    for (const [mapKey, mapVal] of Object.entries(mappings)) {
      if (!isPlistDict(mapVal)) continue;
      const ids: string[] = [];
      for (const [id, v] of Object.entries(countryId)) {
        if (isPlistDict(v) && v.BundleMapKey === mapKey) ids.push(id);
      }
      for (const slot of Object.values(mapVal)) {
        if (!isPlistDict(slot)) continue;
        const target = String(slot.BundleMatchEntry ?? "");
        if (!target) continue;
        const prev = idsFor.get(target) ?? [];
        idsFor.set(target, [...new Set([...prev, ...ids])]);
        if (isPlistDict(slot.OS) && typeof slot.OS.Min === "string") minOsFor.set(target, slot.OS.Min);
      }
    }

    for (const [key, v] of Object.entries(dict(fam.Bundles))) {
      if (!isPlistDict(v) || typeof v.BundleURL !== "string") continue;
      countries.push({
        id: String(v.BundleID ?? key),
        bundleId: String(v.BundleID ?? key),
        key,
        version: String(v.BundleVersion ?? ""),
        url: v.BundleURL,
        minOS: minOsFor.get(key),
        family,
        countryIds: (idsFor.get(key) ?? []).sort(),
      });
    }
  }
  countries.sort((a, b) => a.id.localeCompare(b.id) || compareVersions(a.version, b.version));

  const otherKnown: BundleRef[] = [];
  const carrierBundles = dict(root.CarrierBundles);
  for (const v of Object.values(dict(dict(carrierBundles.iPhone).OtherKnownSettings))) {
    if (!isPlistDict(v)) continue;
    const r = refFromEntry(String(dict(v.OS).Min ?? ""), v, "iPhone");
    if (r) { r.build = String(v.BundleVersion ?? ""); otherKnown.push(r); }
  }

  const watchCarriers: CarrierSummary[] = [];
  const watchVersions = new Map<string, string[]>();
  for (const v of Object.values(dict(dict(carrierBundles.Watch).Bundles))) {
    if (!isPlistDict(v)) continue;
    const id = String(v.BundleID ?? "");
    watchVersions.set(id, [...(watchVersions.get(id) ?? []), String(v.BundleVersion ?? "")]);
  }
  for (const [id, versions] of [...watchVersions].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { cc, display } = splitName(id);
    versions.sort(compareVersions);
    watchCarriers.push({
      name: id, cc, display, versions,
      latestBuild: versions[versions.length - 1],
      productTypes: ["Watch"],
      hasLegacy: false,
    });
  }

  const countOf = (k: string) => Object.keys(dict(root[k])).length;

  return {
    fetchedAt: new Date().toISOString(),
    iTunesVersion: String(root.iTunesMacVersion ?? ""),
    counts: {
      MobileDeviceCarrierBundlesByProductVersion: countOf("MobileDeviceCarrierBundlesByProductVersion"),
      MobileDeviceCarrierBundles: countOf("MobileDeviceCarrierBundles"),
      MobileDeviceCarriersByMccMnc: countOf("MobileDeviceCarriersByMccMnc"),
      MobileDeviceCarriers: countOf("MobileDeviceCarriers"),
      MobileDeviceCarriersByCarrierID: countOf("MobileDeviceCarriersByCarrierID"),
      carriers: carriers.length,
      countryBundles: countries.filter((c) => c.family === "iPhone").length,
      watchCountryBundles: countries.filter((c) => c.family === "Watch").length,
      watchCarriers: watchCarriers.length,
    },
    carriers,
    countries,
    otherKnown,
    watchCarriers,
  };
}

/* ------------------------------------------------------------ MCC/MNC map */

export interface MccMncEntry {
  plmn: string;
  mcc: string;
  mnc: string;
  bundle?: string;
  mvnos: Array<{ bundle: string; iccid?: string; gid1?: string; gid2?: string }>;
}

export interface MccMncTable {
  entries: MccMncEntry[];
  carrierIds: Array<[string, string]>;
  iccids: Array<[string, string]>;
}

export function buildMccMnc(root: Dict): MccMncTable {
  const byMcc = dict(root.MobileDeviceCarriersByMccMnc);
  const flat = dict(root.MobileDeviceCarriers);
  const entries: MccMncEntry[] = [];

  for (const [plmn, v] of Object.entries(byMcc)) {
    const mvnos: MccMncEntry["mvnos"] = [];
    let bundle: string | undefined;
    if (isPlistDict(v)) {
      if (typeof v.BundleName === "string") bundle = v.BundleName;
      if (Array.isArray(v.MVNOs)) {
        for (const m of v.MVNOs) {
          if (!isPlistDict(m)) continue;
          mvnos.push({
            bundle: String(m.BundleName ?? ""),
            iccid: typeof m.ICCID === "string" ? m.ICCID : undefined,
            gid1: typeof m.GID1 === "string" ? m.GID1 : undefined,
            gid2: typeof m.GID2 === "string" ? m.GID2 : undefined,
          });
        }
      }
    }
    entries.push({ plmn, mcc: plmn.slice(0, 3), mnc: plmn.slice(3), bundle, mvnos });
  }
  entries.sort((a, b) => a.plmn.localeCompare(b.plmn));

  // MobileDeviceCarriers is keyed by ICCID prefix (890100, 8901150, ...), not by
  // PLMN, so it is a separate lookup rather than extra rows in the PLMN table.
  const iccids = Object.entries(flat)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .sort((a, b) => a[0].localeCompare(b[0]));

  const idsRoot = dict(root.MobileDeviceCarriersByCarrierID);
  const carrierIds = Object.entries(idsRoot)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .sort((a, b) => a[0].localeCompare(b[0]));

  return { entries, carrierIds, iccids };
}

export function parseManifest(bytes: Uint8Array): Dict {
  const v = parsePlist(bytes);
  if (!isPlistDict(v)) throw new Error("manifest is not a dictionary");
  return v;
}

/** Everything the app reads off the manifest: the lists, each bundle's refs, and the PLMN table. */
export interface ManifestTables {
  index: ManifestIndex;
  refs: Record<string, BundleRef[]>;
  plmn: MccMncTable;
}

export function manifestTables(root: Dict): ManifestTables {
  const index = buildIndex(root);
  const refs: Record<string, BundleRef[]> = {};
  for (const c of [...index.carriers, ...index.watchCarriers]) refs[c.name] ??= carrierRefs(root, c.name);
  return { index, refs, plmn: buildMccMnc(root) };
}
