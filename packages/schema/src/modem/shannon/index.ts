/** Pixel Shannon carrierconfig (manifest, confseqs, cfg.db matchers, item definitions) and uecapconfig -> ModemConfig. */

import { canonical } from "@carrier-explode/values";
import * as v from "valibot";

import { compareUtf8, errorMessage, u32Hex } from "@carrier-explode/binary";

import {
  byName, confseqCaCombinations, decodeConfseq, decodeManifest, decodeUeCap, ITEM_TYPES, itemValue,
  type Component, type HardwareCondition, type ItemDef, type LteCaComponent, type Manifest, type ManifestScope,
  type SimMatcher as ShannonMatcher,
} from "@carrier-explode/decode-shannon";

import { type BandCombination, type BandComponent, type ModemItem, type ModemValue, type SimMatcher } from "../../types.ts";
import { simMatcher, uniqueSims } from "../../sims.ts";
import { jsonMember, member, readOr, type ArchiveFiles, type ConfigDraft, type MappedConfig } from "../archive.ts";
import { combosText, type ComboSource } from "../combos.ts";

export const SHANNON_MANIFEST = "manifest.pb";

/** A setting of the NR stack (`NRCAPA_…`, `NRRRC.…`, `!NRPM.…`), which only a 5G modem's configuration has. */
export const isNrItem = (item: ModemItem): boolean => /^!?NR[A-Z0-9]*[._]/.test(item.name ?? "");
const UECAP = /^uecap\/[^/]+\.binarypb$/;
const ITEMS = "items.json";
const NAMES = "names.json";

const nullable = v.nullable(v.string());
const carrierSchema = v.array(v.object({
  mccMnc: v.string(), imsiPrefix: nullable, spn: nullable, gid1: nullable, gid2: nullable,
  iccidPrefix: nullable, accessRule: nullable, plmnName: nullable, preferredApn: nullable,
}) satisfies v.GenericSchema<unknown, ShannonMatcher>);

const hash = v.pipe(v.string(), v.regex(/^[0-9a-f]{8}$/));
const itemsSchema = v.record(hash, v.object({
  name: v.string(), type: v.picklist(ITEM_TYPES), capacity: v.pipe(v.number(), v.integer(), v.minValue(1)),
}) satisfies v.GenericSchema<unknown, ItemDef>);
const namesSchema = v.record(hash, v.array(v.string()));

/** What an archive says of its items: the registry's definitions, or (archives packed before) names found among the firmware's strings. */
type ItemInfo =
  | { readonly kind: "registry"; readonly defs: Readonly<Record<string, ItemDef>> }
  | { readonly kind: "names"; readonly names: Readonly<Record<string, readonly string[]>> };

const itemInfo = (files: ArchiveFiles): ItemInfo =>
  files.has(ITEMS) ? { kind: "registry", defs: jsonMember(files, ITEMS, itemsSchema) } : { kind: "names", names: jsonMember(files, NAMES, namesSchema) };

/** A LIKE pattern as a prefix (`abc%`, `abc`; "" for any), or undefined for any other use of wildcards. */
const prefixOf = (p: string | null): string | undefined => (p === null ? "" : /^([^%_]+)%?$/.exec(p)?.[1]);

/** cfg.db's rows as SimMatchers; a row with a pattern that is no prefix, or a certificate rule, has none. */
function selectionOf(rows: readonly ShannonMatcher[]): SimMatcher[] {
  return uniqueSims(rows.flatMap((r) => {
    const [imsiPrefix, gid1, gid2] = [prefixOf(r.imsiPrefix), prefixOf(r.gid1), prefixOf(r.gid2)];
    if (r.accessRule !== null || imsiPrefix === undefined || gid1 === undefined || gid2 === undefined || r.spn?.includes("%")) return [];
    return simMatcher({ mccmnc: r.mccMnc, imsiPrefix, gid1, gid2, spn: r.spn ?? "", iccidPrefix: r.iccidPrefix ?? "" }) ?? [];
  }));
}

/** Exact: past 2^53 an int64 becomes decimal text rather than a rounded number. */
const int64 = (v: bigint): ModemValue =>
  BigInt(Number(v)) === v ? { kind: "number", value: Number(v) } : { kind: "text", value: v.toString() };
const numbers = (values: readonly bigint[]): ModemValue =>
  values.length === 1 && values[0] !== undefined ? int64(values[0]) : { kind: "list", values: values.map(int64) };

/** `u16`, `u8[100]`. */
const typeName = (def: ItemDef): string => (def.capacity > 1 ? `${def.type}[${def.capacity}]` : def.type);

/** The value at its registry type; untyped when the archive has no definition or the value breaks it. */
function valueOf(def: ItemDef | undefined, values: readonly bigint[], onError: (e: unknown) => void): ModemValue {
  if (def === undefined) return numbers(values);
  try {
    const typed = itemValue(def, values);
    return typed.kind === "text" ? { kind: "text", value: typed.text } : numbers(typed.values);
  } catch (e) {
    onError(e);
    return numbers(values);
  }
}

type ItemScope = Exclude<ManifestScope, "file">;
type Layer = ReadonlyMap<number, readonly bigint[]>;
/** Per item, per scope, its values after every layer that applies. */
type Effective = Map<number, Map<ItemScope, readonly bigint[]>>;

const conditionKey = (c: HardwareCondition): string => `hw ${c.key}=${c.value}/${c.variant}`;

type Entry = Manifest["entries"][number];
type ItemEntry = Exclude<Entry, { readonly scope: "file" }>;
/** Which of the manifest's entries a view reads: the base layers, or the configuration's own. */
type Part = (e: ItemEntry) => boolean;

/** One device's view of a part: its unconditional entries and those of one hardware condition, in manifest order, later layers overriding. */
function effective(manifest: Manifest, layers: ReadonlyMap<string, NamedLayer>, part: Part, condition: string | null): Effective {
  const out: Effective = new Map();
  for (const e of manifest.entries) {
    if (e.scope === "file" || !part(e) || (e.condition !== null && conditionKey(e.condition) !== condition)) continue;
    for (const [h, values] of layers.get(e.confseq)?.items ?? []) out.set(h, (out.get(h) ?? new Map<ItemScope, readonly bigint[]>()).set(e.scope, values));
  }
  return out;
}

/** The manifest's hardware conditions; one null when it has none. */
function conditionsOf(manifest: Manifest): (string | null)[] {
  const keys = new Set(manifest.entries.flatMap((e) => (e.scope !== "file" && e.condition !== null ? [conditionKey(e.condition)] : [])));
  return keys.size ? [...keys].sort(compareUtf8) : [null];
}

interface NamedLayer {
  /** `default.common`, `us_tmo.sim1`. */
  readonly name: string;
  readonly items: Layer;
}

/** Each confseq decoded once; one that does not decode is an error of its part and an empty layer. */
function layersOf(files: ArchiveFiles, manifest: Manifest, errorsOf: (e: ItemEntry) => string[]): Map<string, NamedLayer> {
  const layers = new Map<string, NamedLayer>();
  for (const e of manifest.entries) {
    if (e.scope === "file" || layers.has(e.confseq)) continue;
    const file = `confseqs/${e.confseq}.pb`;
    layers.set(e.confseq, readOr(errorsOf(e), file, { name: e.confseq, items: new Map() }, (): NamedLayer => {
      const c = decodeConfseq(member(files, file));
      return { name: c.name, items: new Map(c.items.map((it) => [it.hash, it.values])) };
    }));
  }
  return layers;
}

/** A value the same under all `conditions` is keyed by scope alone; one that differs or is missing under some, by scope and condition. */
function itemOf(h: number, byCondition: ReadonlyMap<string | null, ReadonlyMap<ItemScope, ModemValue>>, conditions: number, info: ItemInfo): ModemItem {
  const fields: Record<string, ModemValue> = {};
  const scopes = new Set([...byCondition.values()].flatMap((m) => [...m.keys()]));
  for (const scope of scopes) {
    const set = [...byCondition].flatMap(([c, m]) => {
      const value = m.get(scope);
      return value === undefined ? [] : [[c, value] as const];
    });
    const distinct = new Set(set.map(([, value]) => canonical(value)));
    const [first] = set;
    if (first !== undefined && distinct.size === 1 && set.length === conditions) fields[scope] = first[1];
    else for (const [c, value] of set) fields[c === null ? scope : `${scope} · ${c}`] = value;
  }
  const values = Object.values(fields);
  const [only] = values;
  const id = u32Hex(h);
  const def = info.kind === "registry" ? info.defs[id] : undefined;
  const name = info.kind === "registry" ? def?.name : info.names[id]?.join(" / ");
  return {
    id: `crc:${id}`,
    name: name ?? null,
    description: def === undefined ? null : typeName(def),
    value: only !== undefined && new Set(values.map((v) => canonical(v))).size === 1 ? only : { kind: "fields", fields },
    label: null,
    certainty: name === undefined ? "opaque" : "medium",
  };
}

/** What one part of a manifest sets, typed. */
function partItems(manifest: Manifest, layers: ReadonlyMap<string, NamedLayer>, part: Part, info: ItemInfo, errors: string[]): ModemItem[] {
  const conditions = conditionsOf(manifest);
  const bad = new Set<number>();
  const byHash = new Map<number, Map<string | null, Map<ItemScope, ModemValue>>>();
  for (const c of conditions) {
    for (const [h, scopes] of effective(manifest, layers, part, c)) {
      const def = info.kind === "registry" ? info.defs[u32Hex(h)] : undefined;
      if (info.kind === "registry" && def === undefined && !bad.has(h)) {
        errors.push(`crc:${u32Hex(h)}: not in the modem's item registry; its values are shown untyped`);
        bad.add(h);
      }
      const typed = new Map([...scopes].map(([scope, values]) => [scope, valueOf(def, values, (e) => {
        if (!bad.has(h)) errors.push(`crc:${u32Hex(h)}: ${errorMessage(e)}`);
        bad.add(h);
      })] as const));
      byHash.set(h, (byHash.get(h) ?? new Map<string | null, Map<ItemScope, ModemValue>>()).set(c, typed));
    }
  }
  return [...byHash].map(([h, byCondition]) => itemOf(h, byCondition, conditions.length, info));
}

const LTE_CA = "LTE CA items";

/** The LTE CA combinations a part's common items give, under every hardware condition, each once. */
function lteCa(manifest: Manifest, layers: ReadonlyMap<string, NamedLayer>, part: Part, errors: string[]): BandCombination[] {
  const combos = new Map<string, BandCombination>();
  let unknownUplink = 0;
  for (const c of conditionsOf(manifest)) {
    const common = new Map([...effective(manifest, layers, part, c)].flatMap(([h, scopes]) => {
      const values = scopes.get("common");
      return values === undefined ? [] : [[h, values] as const];
    }));
    const ca = readOr(errors, `${LTE_CA}${c === null ? "" : ` (${c})`}`, { combinations: [], unknownUplink: 0 }, () => confseqCaCombinations(byName(common)));
    unknownUplink = Math.max(unknownUplink, ca.unknownUplink);
    for (const combo of ca.combinations) combos.set(JSON.stringify(combo), combo.map(component));
  }
  if (unknownUplink) errors.push(`${LTE_CA}: ${unknownUplink} combinations with every UL bitmap 0xFFFF, a value not understood, left out`);
  return [...combos.values()];
}

type NrComponent = Extract<Component, { readonly rat: "NR" }>;

/** Per-carrier features, as the most layers, the summed bandwidth and the spacing they share. */
function nrFeatures(features: NrComponent["dl"]): Pick<BandComponent, "dlLayers" | "bandwidthMhz" | "scsKhz"> {
  const [first] = features;
  if (first === undefined) return {};
  const scs = new Set(features.map((f) => f.scsKHz));
  return {
    dlLayers: Math.max(...features.map((f) => f.mimoLayers)),
    bandwidthMhz: features.reduce((n, f) => n + f.bandwidthMHz, 0),
    ...(scs.size === 1 ? { scsKhz: first.scsKHz } : {}),
  };
}

function component(c: Component | LteCaComponent): BandComponent {
  const classes = { dl: c.dlClass, ...(c.ulClass === null ? {} : { ul: c.ulClass }) };
  if ("dlMimoLayers" in c) return { band: `B${c.band}`, ...classes, dlLayers: c.dlMimoLayers };
  return c.rat === "NR" ? { band: `n${c.band}`, ...classes, ...nrFeatures(c.dl) } : { band: `B${c.band}`, ...classes };
}

/** Each uecap file the archive carries, one source each. */
function ueCapCombinations(files: ArchiveFiles, errors: string[]): ComboSource[] {
  return [...files].filter(([name]) => UECAP.test(name)).sort(([a], [b]) => compareUtf8(a, b)).flatMap(([name, bytes]): ComboSource[] => {
    const f = readOr(errors, name, undefined, () => decodeUeCap(bytes));
    return f === undefined || f.kind === "plmn-map" ? [] : [[name, f.combinations.map((combo) => combo.map(component))]];
  });
}

/** `default, endc_common, lte_ca_common`: the base confseqs' layer names, without their scopes. */
function baseLabel(manifest: Manifest, layers: ReadonlyMap<string, NamedLayer>): string {
  const names = manifest.entries.flatMap((e) => (e.scope !== "file" && e.base ? [layers.get(e.confseq)?.name.replace(/\.[^.]+$/, "") ?? e.confseq] : []));
  return [...new Set(names)].join(", ");
}

const isBase: Part = (e) => e.base;
const isOwn: Part = (e) => !e.base;

export function shannonConfig(files: ArchiveFiles, sha: string): MappedConfig {
  const manifest = decodeManifest(member(files, SHANNON_MANIFEST));
  const info = itemInfo(files);
  const errors: string[] = [];
  const baseErrors: string[] = [];
  const layers = layersOf(files, manifest, (e) => (e.base ? baseErrors : errors));
  const layered = manifest.entries.some((e) => e.scope !== "file" && e.base);
  const all: Part = () => true;
  // The carrier's own LTE CA is the one its layers leave in effect, when that is not the base's.
  const baseCa = layered ? lteCa(manifest, layers, isBase, baseErrors) : [];
  const effectiveCa = lteCa(manifest, layers, all, errors);
  const ownCa = combosText(effectiveCa) === combosText(baseCa) ? [] : effectiveCa;
  const matchers = jsonMember(files, "carrier.json", carrierSchema);
  const config: ConfigDraft = {
    family: "shannon",
    sha,
    label: manifest.name,
    // cfg.db names no SIM for it: the modem loads it for a SIM no carrier row matches.
    scope: matchers.length ? "carrier" : "firmware",
    selection: selectionOf(matchers),
    facts: [
      { label: "Manifest version", value: manifest.version },
      ...(manifest.carrierId === 0 ? [] : [{ label: "Carrier id", value: String(manifest.carrierId) }]),
    ],
    items: partItems(manifest, layers, layered ? isOwn : all, info, errors),
    combos: [...ueCapCombinations(files, errors), [LTE_CA, ownCa]],
    errors,
  };
  if (!layered) return { config, base: null };
  const base: Omit<ConfigDraft, "sha"> = {
    family: "shannon",
    label: baseLabel(manifest, layers),
    scope: "firmware",
    selection: [],
    facts: [],
    items: partItems(manifest, layers, isBase, info, baseErrors),
    combos: [[LTE_CA, baseCa]],
    errors: baseErrors,
  };
  return { config, base };
}
