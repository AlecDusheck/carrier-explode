/**
 * iOS bundle -> Profile.
 *
 * The profile describes what the newest phone the bundle names runs with:
 * carrier.plist with that phone's overrides_<boards>.plist on top. Modern
 * bundles keep most of what matters there (T-Mobile's carrier.plist has no 5G
 * key at all; every phone's override sets them), so carrier.plist alone would
 * describe an iPhone nobody buys. Other phone groups and the MVNOOverrides
 * configurations become variants holding only what differs.
 */

import { compareProducts, decodeFile, decodedPlist, flattenBundle, isJsonDict, type BundleFile, type OpenedBundle } from "#lib/decode/index.ts";
import { canonical, toJson } from "../json.ts";
import { matcherKey, PROFILE_SCHEMA, type Apn, type ConceptValue, type Json, type Profile, type ProfileVariant, type SimMatcher, type SourceRef } from "../types.ts";
import { iosApns } from "./apns.ts";
import { iosDisplay, iosIso, supportedSims } from "./identity.ts";
import { iosConcepts } from "./readers.ts";
import { origin, settings, withLayer, type Settings } from "./settings.ts";

type Dict = Readonly<Record<string, unknown>>;

/** A member decoded as a dictionary; undefined when absent or not a plist dictionary (a broken member simply contributes nothing, as on the phone). */
function plistDict(b: OpenedBundle, path: string): Dict | undefined {
  if (!b.info.files.some((f) => f.path === path)) return undefined;
  const v = decodedPlist(decodeFile(b, path));
  return isJsonDict(v) ? v : undefined;
}

const isPhonePlist = (f: BundleFile): boolean => /^overrides_.+\.plist$/.test(f.path);

/** Product types (`iPhone18,1`) an override file names; board codes for boards the device table does not know yet. */
const devicesOf = (f: BundleFile): string[] => (f.devices ?? []).map((d) => d.ids ?? d.code);

/** The newest product type a file names, for ordering; "" when it names none the table knows. */
const newestProduct = (f: BundleFile): string =>
  (f.devices ?? []).flatMap((d) => (d.ids ? [d.ids] : [])).sort(compareProducts).at(-1) ?? "";

interface PhoneGroup { file: BundleFile; dict: Dict }

function phoneGroups(b: OpenedBundle): PhoneGroup[] {
  return b.info.files
    .filter(isPhonePlist)
    .flatMap((file) => { const dict = plistDict(b, file.path); return dict ? [{ file, dict }] : []; })
    .sort((x, y) => compareProducts(newestProduct(y.file), newestProduct(x.file)) || x.file.path.localeCompare(y.file.path));
}

interface Mapped { concepts: Record<string, ConceptValue>; apns: Apn[] }

function mapSettings(s: Settings, kind: SourceRef["kind"]): Mapped {
  const apns = iosApns(s);
  const all = iosConcepts({ settings: s, apns });
  // A country bundle carries place settings (alerts, emergency numbers); the carrier
  // features and unset carrier keys would only say "no" a hundred times.
  const concepts = kind === "country"
    ? Object.fromEntries(Object.entries(all).filter(([, v]) => v.state === undefined && v.value !== null))
    : all;
  return { concepts, apns };
}

/** Concepts whose value differs from the main profile's. */
function differing(main: Readonly<Record<string, ConceptValue>>, other: Readonly<Record<string, ConceptValue>>): Record<string, ConceptValue> {
  return Object.fromEntries(Object.entries(other).filter(([id, v]) => {
    const m = main[id];
    return m === undefined || canonical(m.value) !== canonical(v.value);
  }));
}

const apnText = (apns: readonly Apn[]): string => canonical(apns.map((a) => toJson({ ...a, path: "" }) ?? null));

function variant(id: string, label: string, when: ProfileVariant["when"], main: Mapped, other: Mapped): ProfileVariant | undefined {
  const concepts = differing(main.concepts, other.concepts);
  const apnsDiffer = apnText(main.apns) !== apnText(other.apns);
  if (!Object.keys(concepts).length && !apnsDiffer) return undefined;
  return { id, label, when, concepts, ...(apnsDiffer ? { apns: other.apns } : {}) };
}

function phoneVariants(carrier: Settings, groups: readonly PhoneGroup[], main: Mapped, kind: SourceRef["kind"]): ProfileVariant[] {
  return groups.flatMap((g) => {
    const names = [...new Set((g.file.devices ?? []).map((d) => d.name ?? d.code))];
    const other = mapSettings(withLayer(carrier, { file: g.file.path, prefix: "", dict: g.dict }), kind);
    const v = variant(`phones:${g.file.path}`, names.join(", ") || g.file.path, { devices: devicesOf(g.file) }, main, other);
    return v ? [v] : [];
  });
}

function mvnoVariants(s: Settings, main: Mapped, kind: SourceRef["kind"]): ProfileVariant[] {
  const overrides = s.merged.MVNOOverrides;
  if (!isJsonDict(overrides)) return [];
  return Object.entries(overrides).flatMap(([name, entry]) => {
    if (!isJsonDict(entry) || !isJsonDict(entry.OverrideConfiguration)) return [];
    const conf = entry.OverrideConfiguration;
    // Always found (the entry came out of the merged tree); the fallback only satisfies the type.
    const file = origin(s, `MVNOOverrides.${name}.OverrideConfiguration`)?.file ?? "carrier.plist";
    const other = mapSettings(withLayer(s, { file, prefix: `MVNOOverrides.${name}.OverrideConfiguration.`, dict: conf }), kind);
    const label = typeof conf.CarrierName === "string" && conf.CarrierName ? conf.CarrierName : name;
    const v = variant(`mvno:${name}`, label, { sims: supportedSims(entry.SupportedSIMs) }, main, other);
    return v ? [v] : [];
  });
}

/** Every SIM rule the bundle confirms: SupportedSIMs, and each MVNO configuration's. */
function bundleSims(s: Settings): SimMatcher[] {
  const overrides = s.merged.MVNOOverrides;
  const mvno = isJsonDict(overrides)
    ? Object.values(overrides).flatMap((e) => (isJsonDict(e) ? supportedSims(e.SupportedSIMs) : []))
    : [];
  const byKey = new Map<string, SimMatcher>();
  for (const m of [...supportedSims(s.merged.SupportedSIMs), ...mvno]) {
    if (!byKey.has(matcherKey(m))) byKey.set(matcherKey(m), m);
  }
  return [...byKey.values()];
}

/** Every leaf of every decodable member, keyed `<file>:<path>`. */
function rawOf(b: OpenedBundle): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [file, flat] of Object.entries(flattenBundle(b))) {
    for (const [path, v] of Object.entries(flat)) out[`${file}:${path}`] = toJson(v) ?? null;
  }
  return out;
}

export function iosProfile(bundle: OpenedBundle, source: SourceRef, sha: string): Profile {
  const carrierDict = plistDict(bundle, "carrier.plist") ?? {};
  const info = plistDict(bundle, "Info.plist");
  const carrier = settings([{ file: "carrier.plist", prefix: "", dict: carrierDict }]);
  const [home, ...others] = phoneGroups(bundle);
  const main = home ? withLayer(carrier, { file: home.file.path, prefix: "", dict: home.dict }) : carrier;
  const mapped = mapSettings(main, source.kind);
  const sims = bundleSims(main);
  return {
    schema: PROFILE_SCHEMA,
    source,
    sha,
    version: typeof info?.CFBundleVersion === "string" ? info.CFBundleVersion : "",
    identity: { display: iosDisplay(source), iso: iosIso(source, main.merged, sims), sims },
    apns: mapped.apns,
    concepts: mapped.concepts,
    raw: rawOf(bundle),
    variants: [...phoneVariants(carrier, others, mapped, source.kind), ...mvnoVariants(main, mapped, source.kind)],
  };
}
