/**
 * The iTunes version manifest — the single acquisition entry point for every
 * carrier and country bundle Apple publishes.
 */

import { parsePlist, type PlistValue, bytesToHex } from "$lib/decode";
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

type Dict = Record<string, PlistValue>;
const isDict = (v: PlistValue | undefined): v is Dict =>
  !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array) && !(v instanceof Date);

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
  const byVer = root.MobileDeviceCarrierBundlesByProductVersion;
  if (isDict(byVer) && isDict(byVer[name])) {
    const entry = byVer[name] as Dict;
    for (const [os, v] of Object.entries(entry)) {
      if (os === "ByProductType") {
        if (!isDict(v)) continue;
        for (const [pt, versions] of Object.entries(v)) {
          if (!isDict(versions)) continue;
          for (const [pos, pe] of Object.entries(versions)) {
            if (isDict(pe)) { const r = refFromEntry(pos, pe, pt); if (r) out.push(r); }
          }
        }
        continue;
      }
      if (isDict(v)) { const r = refFromEntry(os, v); if (r) out.push(r); }
    }
  }
  const legacy = root.MobileDeviceCarrierBundles;
  if (isDict(legacy) && isDict(legacy[name])) {
    const r = refFromEntry("legacy", legacy[name] as Dict);
    if (r) out.push(r);
  }
  // Watch + newer-format carrier bundles
  const cb = root.CarrierBundles;
  if (isDict(cb)) {
    for (const family of ["Watch", "iPhone"] as const) {
      const fam = cb[family];
      if (!isDict(fam) || !isDict(fam.Bundles)) continue;
      for (const [key, v] of Object.entries(fam.Bundles as Dict)) {
        if (!isDict(v) || v.BundleID !== name) continue;
        const r = refFromEntry(String(v.OS && isDict(v.OS) ? v.OS.Min : "") || "—", v, family);
        if (r) { r.build = String(v.BundleVersion ?? r.build); r.productType = family; r.os = `${family} ${key.split("_").pop()}`; out.push(r); }
      }
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
  const byVer = isDict(root.MobileDeviceCarrierBundlesByProductVersion)
    ? (root.MobileDeviceCarrierBundlesByProductVersion as Dict) : {};
  const legacy = isDict(root.MobileDeviceCarrierBundles) ? (root.MobileDeviceCarrierBundles as Dict) : {};

  const names = new Set<string>();
  for (const k of Object.keys(byVer)) if (isDict(byVer[k])) names.add(k);
  for (const k of Object.keys(legacy)) if (isDict(legacy[k])) names.add(k);

  const carriers: CarrierSummary[] = [];
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const entry = isDict(byVer[name]) ? (byVer[name] as Dict) : {};
    const versions: string[] = [];
    const productTypes = new Set<string>();
    for (const [os, v] of Object.entries(entry)) {
      if (os === "ByProductType") {
        if (isDict(v)) {
          for (const [pt, versions] of Object.entries(v)) {
            // { FallbackToByProductVersion: true } means "no bundles of its own".
            if (!isDict(versions)) continue;
            const real = Object.values(versions).some(
              (e) => isDict(e) && typeof e.BundleURL === "string",
            );
            if (real) productTypes.add(pt);
          }
        }
        continue;
      }
      if (isDict(v) && typeof v.BundleURL === "string") versions.push(os);
    }
    versions.sort(compareVersions);
    const newest = versions.length ? (entry[versions[versions.length - 1]] as Dict) : undefined;
    const { cc, display } = splitName(name);
    carriers.push({
      name,
      cc,
      display,
      versions,
      latestBuild: newest && typeof newest.BuildVersion === "string" ? newest.BuildVersion : undefined,
      productTypes: [...productTypes].sort(),
      hasLegacy: isDict(legacy[name]),
    });
  }

  // Country bundles, both families, resolved through BundleMappings + CountryId.
  const countries: CountrySummary[] = [];
  const cbRoot = isDict(root.CountryBundles) ? (root.CountryBundles as Dict) : {};
  for (const family of ["iPhone", "Watch"] as const) {
    const fam = cbRoot[family];
    if (!isDict(fam) || !isDict(fam.Bundles)) continue;
    const mappings = isDict(fam.BundleMappings) ? (fam.BundleMappings as Dict) : {};
    const countryId = isDict(fam.CountryId) ? (fam.CountryId as Dict) : {};

    const idsFor = new Map<string, string[]>(); // bundle key -> CountryId keys
    const minOsFor = new Map<string, string>();
    for (const [mapKey, mapVal] of Object.entries(mappings)) {
      if (!isDict(mapVal)) continue;
      const ids: string[] = [];
      for (const [id, v] of Object.entries(countryId)) {
        if (isDict(v) && v.BundleMapKey === mapKey) ids.push(id);
      }
      for (const slot of Object.values(mapVal)) {
        if (!isDict(slot)) continue;
        const target = String(slot.BundleMatchEntry ?? "");
        if (!target) continue;
        const prev = idsFor.get(target) ?? [];
        idsFor.set(target, [...new Set([...prev, ...ids])]);
        if (isDict(slot.OS) && typeof slot.OS.Min === "string") minOsFor.set(target, slot.OS.Min);
      }
    }

    for (const [key, v] of Object.entries(fam.Bundles as Dict)) {
      if (!isDict(v) || typeof v.BundleURL !== "string") continue;
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
  const carrierBundles = isDict(root.CarrierBundles) ? (root.CarrierBundles as Dict) : {};
  const ip = carrierBundles.iPhone;
  if (isDict(ip) && isDict(ip.OtherKnownSettings)) {
    for (const [, v] of Object.entries(ip.OtherKnownSettings as Dict)) {
      if (!isDict(v)) continue;
      const r = refFromEntry(isDict(v.OS) ? String(v.OS.Min ?? "") : "", v, "iPhone");
      if (r) { r.build = String(v.BundleVersion ?? ""); otherKnown.push(r); }
    }
  }

  const watchCarriers: CarrierSummary[] = [];
  const watch = carrierBundles.Watch;
  if (isDict(watch) && isDict(watch.Bundles)) {
    const byId = new Map<string, { versions: string[]; latest?: string }>();
    for (const [, v] of Object.entries(watch.Bundles as Dict)) {
      if (!isDict(v)) continue;
      const id = String(v.BundleID ?? "");
      const rec = byId.get(id) ?? { versions: [] };
      rec.versions.push(String(v.BundleVersion ?? ""));
      byId.set(id, rec);
    }
    for (const [id, rec] of [...byId].sort((a, b) => a[0].localeCompare(b[0]))) {
      const { cc, display } = splitName(id);
      watchCarriers.push({
        name: id, cc, display,
        versions: rec.versions.sort(compareVersions),
        latestBuild: rec.versions[rec.versions.length - 1],
        productTypes: ["Watch"],
        hasLegacy: false,
      });
    }
  }

  const countOf = (k: string) => (isDict(root[k]) ? Object.keys(root[k] as Dict).length : 0);

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

export function buildMccMnc(root: Dict): {
  entries: MccMncEntry[];
  carrierIds: Array<[string, string]>;
  iccids: Array<[string, string]>;
} {
  const byMcc = isDict(root.MobileDeviceCarriersByMccMnc) ? (root.MobileDeviceCarriersByMccMnc as Dict) : {};
  const flat = isDict(root.MobileDeviceCarriers) ? (root.MobileDeviceCarriers as Dict) : {};
  const entries: MccMncEntry[] = [];

  for (const [plmn, v] of Object.entries(byMcc)) {
    const mvnos: MccMncEntry["mvnos"] = [];
    let bundle: string | undefined;
    if (isDict(v)) {
      if (typeof v.BundleName === "string") bundle = v.BundleName;
      if (Array.isArray(v.MVNOs)) {
        for (const m of v.MVNOs) {
          if (!isDict(m)) continue;
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

  const idsRoot = isDict(root.MobileDeviceCarriersByCarrierID) ? (root.MobileDeviceCarriersByCarrierID as Dict) : {};
  const carrierIds = Object.entries(idsRoot)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .sort((a, b) => a[0].localeCompare(b[0]));

  return { entries, carrierIds, iccids };
}

export function parseManifest(bytes: Uint8Array): Dict {
  const v = parsePlist(bytes);
  if (!isDict(v)) throw new Error("manifest is not a dictionary");
  return v;
}
