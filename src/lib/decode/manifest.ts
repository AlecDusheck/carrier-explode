/**
 * Apple's carrier bundle manifest (the iTunes "version" plist): every carrier
 * and country bundle Apple publishes over the air, and the SIM tables that pick
 * one. Parsing only; who fetches it, and how often, is up to the caller.
 */

import { bytesToHex } from "./bytes";
import { isPlistDict, parsePlist, type PlistDict, type PlistValue } from "./plist";
import { compareVersions } from "./versions";

export const MANIFEST_URL =
  "https://itunes.apple.com/WebObjects/MZStore.woa/wa/com.apple.jingle.appserver.client.MZITunesClientCheck/version";

export interface BundleRef {
  /** iOS version key this entry is published under, "legacy", or "<family> <n>" for a CarrierBundles entry. */
  os: string;
  build: string;
  url: string;
  /** SHA-1 of the file, hex. Absent where the entry only carries a long digest. */
  digest?: string;
  /** SHA-384, hex. Newer entries put it under Digest3; Watch and country entries put it under the plain Digest key, so it is routed by length. */
  digest3?: string;
  /** Present for ByProductType entries (iPad, iPod, …) and CarrierBundles entries (iPhone, Watch). */
  productType?: string;
}

export interface ManifestCarrier {
  name: string;
  /** iOS version keys, oldest first. */
  versions: string[];
  latestBuild?: string;
  productTypes: string[];
  hasLegacy: boolean;
}

export interface ManifestCountry {
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
  iTunesVersion: string;
  counts: Record<string, number>;
  carriers: ManifestCarrier[];
  countries: ManifestCountry[];
  /** CarrierBundles.iPhone.OtherKnownSettings. */
  otherKnown: BundleRef[];
  watchCarriers: ManifestCarrier[];
}

type Dict = PlistDict;

/** `v` when it is a dictionary, else an empty one. */
const dict = (v: PlistValue | undefined): Dict => (isPlistDict(v) ? v : {});
/** The dictionary-valued entries of `d`. */
const dicts = (d: Dict): Array<[string, Dict]> => Object.entries(d).flatMap(([k, v]) => (isPlistDict(v) ? [[k, v]] : []));
const text = (v: PlistValue | undefined): string => (v === undefined || v === null ? "" : String(v));

function refFromEntry(os: string, e: Dict, productType?: string): BundleRef | null {
  const url = e.BundleURL;
  if (typeof url !== "string") return null;
  const plain = e.Digest instanceof Uint8Array ? e.Digest : undefined;
  const long = e.Digest3 instanceof Uint8Array ? e.Digest3 : undefined;
  const digest3 = long ?? (plain?.length === 48 ? plain : undefined);
  return {
    os,
    build: typeof e.BuildVersion === "string" ? e.BuildVersion : text(e.BundleVersion),
    url,
    ...(plain?.length === 20 ? { digest: bytesToHex(plain) } : {}),
    ...(digest3 ? { digest3: bytesToHex(digest3) } : {}),
    ...(productType ? { productType } : {}),
  };
}

/**
 * When Apple published a bundle file, read off its URL: YYYY-MM-DD from
 * `/20261001/`, `/031-04427-20150119-…/` or `/031-2099.20131204.rVQEN/`, and
 * just YYYY from the 2020-2022 scheme, whose path only has `/2020/`, or from a
 * malformed date (`2019503`, `/202206043/`). A YYYY sorts after every full date
 * of the same year.
 */
export function publishedOn(url: string): string | undefined {
  for (const [, y, m, d] of url.matchAll(/(?<=[/.-])(20\d\d)(\d\d)(\d\d)(?=[/.-])/g)) {
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) return `${y}-${m}-${d}`;
  }
  return url.match(/\/(20\d\d)\d*\//)?.[1];
}

/** All published refs for one carrier name: iOS-family newest first, then Watch. */
export function carrierRefs(root: Dict, name: string): BundleRef[] {
  const out: BundleRef[] = [];
  const add = (r: BundleRef | null): void => {
    if (r) out.push(r);
  };
  for (const [os, v] of dicts(dict(dict(root.MobileDeviceCarrierBundlesByProductVersion)[name]))) {
    if (os !== "ByProductType") {
      add(refFromEntry(os, v));
      continue;
    }
    for (const [pt, versions] of dicts(v)) for (const [pos, pe] of dicts(versions)) add(refFromEntry(pos, pe, pt));
  }
  const legacy = dict(root.MobileDeviceCarrierBundles)[name];
  if (isPlistDict(legacy)) add(refFromEntry("legacy", legacy));

  // Watch and newer-format carrier bundles: keyed by an opaque id, named by BundleID.
  const cb = dict(root.CarrierBundles);
  for (const family of ["Watch", "iPhone"] as const) {
    for (const [key, v] of dicts(dict(dict(cb[family]).Bundles))) {
      if (v.BundleID !== name) continue;
      const r = refFromEntry(text(dict(v.OS).Min) || "—", v, family);
      if (r) out.push({ ...r, build: text(v.BundleVersion) || r.build, os: `${family} ${key.split("_").pop() ?? key}` });
    }
  }
  // iOS keys and Watch bundle versions are different numbering schemes, so they
  // are grouped rather than interleaved: iOS-family newest first, then Watch.
  const group = (r: BundleRef): number => (r.productType === "Watch" ? 1 : 0);
  return out.sort((a, b) =>
    group(a) - group(b) ||
    (group(a) === 1 ? compareVersions(b.build, a.build) : compareVersions(b.os, a.os) || compareVersions(b.build, a.build)));
}

function manifestCarrier(name: string, entry: Dict, hasLegacy: boolean): ManifestCarrier {
  const versions: string[] = [];
  const productTypes = new Set<string>();
  for (const [os, v] of Object.entries(entry)) {
    if (os === "ByProductType") {
      // { FallbackToByProductVersion: true } means "no bundles of its own".
      for (const [pt, byOs] of dicts(dict(v))) {
        if (Object.values(byOs).some((e) => isPlistDict(e) && typeof e.BundleURL === "string")) productTypes.add(pt);
      }
    } else if (isPlistDict(v) && typeof v.BundleURL === "string") {
      versions.push(os);
    }
  }
  versions.sort(compareVersions);
  const newest = dict(entry[versions.at(-1) ?? ""]);
  return {
    name,
    versions,
    ...(typeof newest.BuildVersion === "string" ? { latestBuild: newest.BuildVersion } : {}),
    productTypes: [...productTypes].sort(),
    hasLegacy,
  };
}

/** Country bundles of one family, resolved through BundleMappings and CountryId. */
function manifestCountries(fam: Dict, family: ManifestCountry["family"]): ManifestCountry[] {
  const countryId = dict(fam.CountryId);
  const idsFor = new Map<string, Set<string>>();
  const minOsFor = new Map<string, string>();
  for (const [mapKey, slots] of dicts(dict(fam.BundleMappings))) {
    const ids = Object.entries(countryId).flatMap(([id, v]) => (isPlistDict(v) && v.BundleMapKey === mapKey ? [id] : []));
    for (const [, slot] of dicts(slots)) {
      const target = text(slot.BundleMatchEntry);
      if (!target) continue;
      const set = idsFor.get(target) ?? new Set<string>();
      for (const id of ids) set.add(id);
      idsFor.set(target, set);
      const os = slot.OS;
      if (isPlistDict(os) && typeof os.Min === "string") minOsFor.set(target, os.Min);
    }
  }
  return dicts(dict(fam.Bundles)).flatMap(([key, v]): ManifestCountry[] => {
    if (typeof v.BundleURL !== "string") return [];
    const id = text(v.BundleID) || key;
    const minOS = minOsFor.get(key);
    return [{
      id, bundleId: id, key,
      version: text(v.BundleVersion),
      url: v.BundleURL,
      ...(minOS ? { minOS } : {}),
      family,
      countryIds: [...(idsFor.get(key) ?? [])].sort(),
    }];
  });
}

export function buildIndex(root: Dict): ManifestIndex {
  const byVer = dict(root.MobileDeviceCarrierBundlesByProductVersion);
  const legacy = dict(root.MobileDeviceCarrierBundles);
  const names = new Set([...dicts(byVer), ...dicts(legacy)].map(([k]) => k));
  const carriers = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => manifestCarrier(name, dict(byVer[name]), isPlistDict(legacy[name])));

  const cbRoot = dict(root.CountryBundles);
  const countries = [
    ...manifestCountries(dict(cbRoot.iPhone), "iPhone"),
    ...manifestCountries(dict(cbRoot.Watch), "Watch"),
  ].sort((a, b) => a.id.localeCompare(b.id) || compareVersions(a.version, b.version));

  const carrierBundles = dict(root.CarrierBundles);
  const otherKnown = dicts(dict(dict(carrierBundles.iPhone).OtherKnownSettings)).flatMap(([, v]) => {
    const r = refFromEntry(text(dict(v.OS).Min), v, "iPhone");
    return r ? [{ ...r, build: text(v.BundleVersion) }] : [];
  });

  const watchVersions = new Map<string, string[]>();
  for (const [, v] of dicts(dict(dict(carrierBundles.Watch).Bundles))) {
    const id = text(v.BundleID);
    watchVersions.set(id, [...(watchVersions.get(id) ?? []), text(v.BundleVersion)]);
  }
  const watchCarriers = [...watchVersions]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, versions]): ManifestCarrier => {
      const sorted = [...versions].sort(compareVersions);
      const latest = sorted.at(-1);
      return { name, versions: sorted, ...(latest ? { latestBuild: latest } : {}), productTypes: ["Watch"], hasLegacy: false };
    });

  const countOf = (k: string): number => Object.keys(dict(root[k])).length;
  return {
    iTunesVersion: text(root.iTunesMacVersion),
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

export interface MvnoRule {
  bundle: string;
  iccid?: string;
  gid1?: string;
  gid2?: string;
}

export interface MccMncEntry {
  plmn: string;
  mcc: string;
  mnc: string;
  bundle?: string;
  mvnos: MvnoRule[];
}

export interface MccMncTable {
  entries: MccMncEntry[];
  carrierIds: Array<[string, string]>;
  iccids: Array<[string, string]>;
}

function mvnoRule(m: Dict): MvnoRule {
  const pick = (k: "ICCID" | "GID1" | "GID2"): string | undefined => (typeof m[k] === "string" ? m[k] : undefined);
  const [iccid, gid1, gid2] = [pick("ICCID"), pick("GID1"), pick("GID2")];
  return {
    bundle: text(m.BundleName),
    ...(iccid ? { iccid } : {}),
    ...(gid1 ? { gid1 } : {}),
    ...(gid2 ? { gid2 } : {}),
  };
}

/** String-valued entries of a table, sorted by key. */
const stringPairs = (d: Dict): Array<[string, string]> =>
  Object.entries(d)
    .flatMap(([k, v]): Array<[string, string]> => (typeof v === "string" ? [[k, v]] : []))
    .sort((a, b) => a[0].localeCompare(b[0]));

export function buildMccMnc(root: Dict): MccMncTable {
  const entries = Object.entries(dict(root.MobileDeviceCarriersByMccMnc)).map(([plmn, v]): MccMncEntry => {
    const e = dict(v);
    const mvnos = Array.isArray(e.MVNOs) ? e.MVNOs.filter(isPlistDict).map(mvnoRule) : [];
    return {
      plmn, mcc: plmn.slice(0, 3), mnc: plmn.slice(3),
      ...(typeof e.BundleName === "string" ? { bundle: e.BundleName } : {}),
      mvnos,
    };
  });
  entries.sort((a, b) => a.plmn.localeCompare(b.plmn));
  // MobileDeviceCarriers is keyed by ICCID prefix (890100, 8901150, ...), not by
  // PLMN, so it is a separate lookup rather than extra rows in the PLMN table.
  return {
    entries,
    carrierIds: stringPairs(dict(root.MobileDeviceCarriersByCarrierID)),
    iccids: stringPairs(dict(root.MobileDeviceCarriers)),
  };
}

export function parseManifest(bytes: Uint8Array): Dict {
  const v = parsePlist(bytes);
  if (!isPlistDict(v)) throw new Error("manifest is not a dictionary");
  return v;
}

/** Everything a reader takes off the manifest: the lists, each bundle's refs, and the PLMN table. */
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
