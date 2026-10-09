/** Pixel Shannon carrierconfig (manifest, confseqs, cfg.db matchers, item definitions) and uecapconfig -> ModemConfig. */

import { canonical } from "@carrier-explode/values";
import * as v from "valibot";

import { compareUtf8, errorMessage, u32Hex } from "@carrier-explode/binary";

import {
	byName,
	confseqCaCombinations,
	decodeConfseq,
	decodeManifest,
	decodeUeCap,
	ITEM_TYPES,
	itemValue,
	type Component,
	type HardwareCondition,
	type ItemDef,
	type LteCaComponent,
	type Manifest,
	type ManifestScope,
	type SimMatcher as ShannonMatcher,
} from "@carrier-explode/decode-shannon";

import {
	type BandCombination,
	OWNER_SEPARATOR,
	type BandComponent,
	type CarrierFeatures,
	type ModemItem,
	type ModemValue,
	type SimMatcher,
} from "../../types.ts";
import { simMatcher, uniqueSims } from "../../sims.ts";
import {
	jsonMember,
	member,
	readOr,
	type ArchiveFiles,
	type ConfigDraft,
	type MappedConfig,
} from "../archive.ts";
import { combosText, type ComboSource } from "../combos.ts";

export const SHANNON_MANIFEST = "manifest.pb";

/** A setting of the NR stack (`NRCAPA_…`, `NRRRC.…`, `!NRPM.…`), which only a 5G modem's configuration has. */
export const isNrItem = (item: Pick<ModemItem, "name">): boolean =>
	/^!?NR[A-Z0-9]*[._]/.test(item.name ?? "");
const UECAP = /^uecap\/[^/]+\.binarypb$/;
const ITEMS = "items.json";

const nullable = v.nullable(v.string());
const carrierSchema = v.array(
	v.object({
		mccMnc: v.string(),
		imsiPrefix: nullable,
		spn: nullable,
		gid1: nullable,
		gid2: nullable,
		iccidPrefix: nullable,
		accessRule: nullable,
		plmnName: nullable,
		preferredApn: nullable,
	}) satisfies v.GenericSchema<unknown, ShannonMatcher>,
);

const hash = v.pipe(v.string(), v.regex(/^[0-9a-f]{8}$/));
const itemsSchema = v.record(
	hash,
	v.object({
		name: v.string(),
		type: v.picklist(ITEM_TYPES),
		capacity: v.pipe(v.number(), v.integer(), v.minValue(1)),
	}) satisfies v.GenericSchema<unknown, ItemDef>,
);

/** The firmware registry's definitions of an archive's items, by hash. */
type ItemDefs = Readonly<Record<string, ItemDef>>;

/** A LIKE pattern as a prefix (`abc%`, `abc`; "" for any), or undefined for any other use of wildcards. */
const prefixOf = (p: string | null): string | undefined => (p === null ? "" : /^([^%_]+)%?$/.exec(p)?.[1]);

/** A cfg.db row as a SimMatcher; none for a pattern that is no prefix, or a certificate rule. */
function rowMatcher(r: ShannonMatcher): SimMatcher | undefined {
	const [imsiPrefix, gid1, gid2] = [prefixOf(r.imsiPrefix), prefixOf(r.gid1), prefixOf(r.gid2)];
	if (
		r.accessRule !== null ||
		imsiPrefix === undefined ||
		gid1 === undefined ||
		gid2 === undefined ||
		r.spn?.includes("%")
	)
		return undefined;
	return simMatcher({
		mccmnc: r.mccMnc,
		imsiPrefix,
		gid1,
		gid2,
		spn: r.spn ?? "",
		iccidPrefix: r.iccidPrefix ?? "",
	});
}

const ROW_FIELDS = [
	["imsiPrefix", "IMSI"],
	["spn", "SPN"],
	["gid1", "GID1"],
	["gid2", "GID2"],
	["iccidPrefix", "ICCID"],
	["plmnName", "PLMN name"],
	["preferredApn", "preferred APN"],
	["accessRule", "certificate"],
] as const satisfies ReadonlyArray<readonly [Exclude<keyof ShannonMatcher, "mccMnc">, string]>;

/**
 * A cfg.db row the selection does not state as it is: libsitril also matches the SIM's PLMN name and preferred APN,
 * which a SimMatcher has no field for, and patterns and certificate rules no matcher states.
 */
function unstatedRow(r: ShannonMatcher): { label: string; value: string } | undefined {
	const stated = rowMatcher(r) !== undefined;
	if (stated && r.plmnName === null && r.preferredApn === null) return undefined;
	const fields = ROW_FIELDS.flatMap(([key, name]) => (r[key] === null ? [] : [`${name} ${r[key]}`]));
	const left = [
		...(r.plmnName === null ? [] : ["PLMN name"]),
		...(r.preferredApn === null ? [] : ["preferred APN"]),
	].join(" and ");
	const why = stated ? `its selection leaves the ${left} out` : "no SIM matcher states it";
	return { label: "cfg.db rule", value: `${[r.mccMnc, ...fields].join(" · ")} (${why})` };
}

/** Exact: past 2^53 an int64 becomes decimal text rather than a rounded number. */
const int64 = (n: bigint): ModemValue =>
	BigInt(Number(n)) === n ? { kind: "number", value: Number(n) } : { kind: "text", value: n.toString() };
const numbers = (values: readonly bigint[]): ModemValue =>
	values.length === 1 && values[0] !== undefined
		? int64(values[0])
		: { kind: "list", values: values.map(int64) };

/** `u16`, `u8[100]`. */
const typeName = (def: ItemDef): string => (def.capacity > 1 ? `${def.type}[${def.capacity}]` : def.type);

/** The value at its registry type; untyped when the archive has no definition or the value breaks it. */
function valueOf(
	def: ItemDef | undefined,
	values: readonly bigint[],
	onError: (e: unknown) => void,
): ModemValue {
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
/** One layer's values for an item. */
interface Write {
	readonly layer: string;
	readonly values: readonly bigint[];
}
/** Per item, per scope, each layer's write in manifest order: the modem applies them in turn, so the last is in effect. */
type Writes = Map<number, Map<ItemScope, Write[]>>;

const conditionKey = (c: HardwareCondition): string => `hw ${c.key}=${c.value}/${c.variant}`;

type Entry = Manifest["entries"][number];
type ItemEntry = Exclude<Entry, { readonly scope: "file" }>;
/** Which of the manifest's entries a view reads: the base layers, or the configuration's own. */
type Part = (e: ItemEntry) => boolean;

/** One device's view of a part: its unconditional entries and those of one hardware condition, in manifest order. */
function writesOf(
	manifest: Manifest,
	layers: ReadonlyMap<string, NamedLayer>,
	part: Part,
	condition: string | null,
): Writes {
	const out: Writes = new Map();
	for (const e of manifest.entries) {
		if (e.scope === "file" || !part(e) || (e.condition !== null && conditionKey(e.condition) !== condition))
			continue;
		const layer = layers.get(e.confseq);
		for (const [h, values] of layer?.items ?? []) {
			const scopes = out.get(h) ?? new Map<ItemScope, Write[]>();
			scopes.set(e.scope, [...(scopes.get(e.scope) ?? []), { layer: layer?.name ?? e.confseq, values }]);
			out.set(h, scopes);
		}
	}
	return out;
}

/** The values in effect: each scope's last write. */
const inEffect = (scopes: ReadonlyMap<ItemScope, readonly Write[]>): Map<ItemScope, readonly bigint[]> =>
	new Map(
		[...scopes].flatMap(([scope, writes]) => {
			const last = writes.at(-1);
			return last === undefined ? [] : [[scope, last.values] as const];
		}),
	);

/** The manifest's hardware conditions; one null when it has none. */
function conditionsOf(manifest: Manifest): (string | null)[] {
	const keys = new Set(
		manifest.entries.flatMap((e) =>
			e.scope !== "file" && e.condition !== null ? [conditionKey(e.condition)] : [],
		),
	);
	return keys.size ? [...keys].toSorted(compareUtf8) : [null];
}

interface NamedLayer {
	/** `default.common`, `us_tmo.sim1`. */
	readonly name: string;
	readonly items: Layer;
}

/** Each confseq decoded once; one that does not decode is an error of its part and an empty layer. */
function layersOf(
	files: ArchiveFiles,
	manifest: Manifest,
	errorsOf: (e: ItemEntry) => string[],
): Map<string, NamedLayer> {
	const layers = new Map<string, NamedLayer>();
	for (const e of manifest.entries) {
		if (e.scope === "file" || layers.has(e.confseq)) continue;
		const file = `confseqs/${e.confseq}.pb`;
		layers.set(
			e.confseq,
			readOr(errorsOf(e), file, { name: e.confseq, items: new Map() }, (): NamedLayer => {
				const c = decodeConfseq(member(files, file));
				return { name: c.name, items: new Map(c.items.map((it) => [it.hash, it.values])) };
			}),
		);
	}
	return layers;
}

/** A value the same under all `conditions` is keyed by scope alone; one that differs or is missing under some, by scope and condition. */
function itemOf(
	h: number,
	byCondition: ReadonlyMap<string | null, ReadonlyMap<ItemScope, ModemValue>>,
	conditions: number,
	defs: ItemDefs,
	replacedBy: string | null,
): ModemItem {
	const fields: Record<string, ModemValue> = {};
	const scopes = new Set<ItemScope>();
	for (const m of byCondition.values()) for (const scope of m.keys()) scopes.add(scope);
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
	const def = defs[id];
	const name = def?.name;
	const typed = def === undefined ? UNREGISTERED : typeName(def);
	return {
		id: replacedBy === null ? `crc:${id}` : `crc:${id}?${replacedBy}`,
		name: name ?? null,
		description:
			replacedBy === null
				? typed
				: `${typed}${OWNER_SEPARATOR}set by ${replacedBy}, which a later layer replaces`,
		value:
			only !== undefined && new Set(values.map((value) => canonical(value))).size === 1
				? only
				: { kind: "fields", fields },
		label: null,
		certainty: name === undefined ? "opaque" : "medium",
	};
}

/** The firmware skips such an item when it applies the configuration. */
const UNREGISTERED = "Not in this firmware's item registry, so the modem skips it; values untyped";

type ByCondition = Map<string | null, Map<ItemScope, ModemValue>>;

const addValue = (
	into: Map<string, ByCondition>,
	key: string,
	c: string | null,
	scope: ItemScope,
	value: ModemValue,
): void => {
	const byCondition = into.get(key) ?? new Map<string | null, Map<ItemScope, ModemValue>>();
	byCondition.set(c, (byCondition.get(c) ?? new Map<ItemScope, ModemValue>()).set(scope, value));
	into.set(key, byCondition);
};

/**
 * What one part of a manifest sets, typed: each item in effect, then each value a later layer replaced, as
 * `crc:<hash>?<layer>`.
 */
function partItems(
	manifest: Manifest,
	layers: ReadonlyMap<string, NamedLayer>,
	part: Part,
	defs: ItemDefs,
	errors: string[],
): ModemItem[] {
	const conditions = conditionsOf(manifest);
	const bad = new Set<number>();
	const typed = (h: number, values: readonly bigint[]): ModemValue =>
		valueOf(defs[u32Hex(h)], values, (e) => {
			if (!bad.has(h)) errors.push(`crc:${u32Hex(h)}: ${errorMessage(e)}`);
			bad.add(h);
		});
	const final = new Map<number, ByCondition>();
	const replaced = new Map<string, ByCondition>();
	const replacedOf = new Map<string, { readonly h: number; readonly layer: string }>();
	for (const c of conditions) {
		for (const [h, scopes] of writesOf(manifest, layers, part, c)) {
			for (const [scope, values] of inEffect(scopes)) {
				const byCondition = final.get(h) ?? new Map<string | null, Map<ItemScope, ModemValue>>();
				byCondition.set(
					c,
					(byCondition.get(c) ?? new Map<ItemScope, ModemValue>()).set(scope, typed(h, values)),
				);
				final.set(h, byCondition);
			}
			for (const [scope, writes] of scopes) {
				const last = writes.at(-1);
				for (const w of writes.slice(0, -1)) {
					if (last === undefined || canonical(w.values.map(String)) === canonical(last.values.map(String)))
						continue;
					const key = `${h}?${w.layer}`;
					replacedOf.set(key, { h, layer: w.layer });
					addValue(replaced, key, c, scope, typed(h, w.values));
				}
			}
		}
	}
	return [
		...[...final].map(([h, byCondition]) => itemOf(h, byCondition, conditions.length, defs, null)),
		...[...replacedOf].flatMap(([key, { h, layer }]) => {
			const byCondition = replaced.get(key);
			return byCondition === undefined ? [] : [itemOf(h, byCondition, conditions.length, defs, layer)];
		}),
	];
}

const LTE_CA = "LTE CA items";

/** The LTE CA combinations a part's common items give, under every hardware condition, each once. */
function lteCa(
	manifest: Manifest,
	layers: ReadonlyMap<string, NamedLayer>,
	part: Part,
	errors: string[],
): BandCombination[] {
	const combos = new Map<string, BandCombination>();
	let unknownUplink = 0;
	for (const c of conditionsOf(manifest)) {
		const common = new Map(
			[...writesOf(manifest, layers, part, c)].flatMap(([h, scopes]) => {
				const values = inEffect(scopes).get("common");
				return values === undefined ? [] : [[h, values] as const];
			}),
		);
		const ca = readOr(
			errors,
			`${LTE_CA}${c === null ? "" : ` (${c})`}`,
			{ combinations: [], unknownUplink: 0 },
			() => confseqCaCombinations(byName(common)),
		);
		unknownUplink = Math.max(unknownUplink, ca.unknownUplink);
		for (const combo of ca.combinations) combos.set(JSON.stringify(combo), combo.map(lteCaComponent));
	}
	if (unknownUplink)
		errors.push(
			`${LTE_CA}: ${unknownUplink} combinations with every UL bitmap 0xFFFF, a value not understood, left out`,
		);
	return [...combos.values()];
}

type NrComponent = Extract<Component, { readonly rat: "NR" }>;

/** Per-carrier features, as the most layers, the summed bandwidth and the spacing they share. */
function nrFeatures(
	features: NrComponent["dl"],
): Pick<BandComponent, "dlLayers" | "bandwidthMhz" | "scsKhz"> {
	const [first] = features;
	if (first === undefined) return {};
	const scs = new Set(features.map((f) => f.scsKHz));
	return {
		dlLayers: Math.max(...features.map((f) => f.mimoLayers)),
		bandwidthMhz: features.reduce((n, f) => n + f.bandwidthMHz, 0),
		...(scs.size === 1 ? { scsKhz: first.scsKHz } : {}),
	};
}

const carrierFeatures = (f: NrComponent["dl" | "ul"][number]): CarrierFeatures => ({
	scsKhz: f.scsKHz,
	bandwidthMhz: f.bandwidthMHz,
	layers: f.mimoLayers,
	maxModulation: f.maxModulation,
	bandwidth90Mhz: f.bandwidth90MHz,
	...("nonCbMimoLayers" in f ? { nonCbLayers: f.nonCbMimoLayers } : {}),
});

const lteCaComponent = (c: LteCaComponent): BandComponent => ({
	band: `B${c.band}`,
	dl: c.dlClass,
	...(c.ulClass === null ? {} : { ul: c.ulClass }),
	dlLayers: c.dlMimoLayers,
});

function component(c: Component): BandComponent {
	const own = {
		dl: c.dlClass,
		...(c.ulClass === null ? {} : { ul: c.ulClass }),
		dlFeatureSet: c.dlFeatureSet,
		ulFeatureSet: c.ulFeatureSet,
	};
	if (c.rat === "LTE") return { band: `B${c.band}`, ...own };
	return {
		band: `n${c.band}`,
		...own,
		...nrFeatures(c.dl),
		dlCarriers: c.dl.map(carrierFeatures),
		ulCarriers: c.ul.map(carrierFeatures),
	};
}

/** Each uecap file the archive carries, one source each. */
function ueCapCombinations(files: ArchiveFiles, errors: string[]): ComboSource[] {
	return [...files]
		.filter(([name]) => UECAP.test(name))
		.toSorted(([a], [b]) => compareUtf8(a, b))
		.flatMap(([name, bytes]): ComboSource[] => {
			const f = readOr(errors, name, undefined, () => decodeUeCap(bytes));
			if (f === undefined || f.kind === "plmn-map") return [];
			if (f.kind === "lte-ca") return [[name, f.combinations.map((c) => c.map(lteCaComponent))]];
			const switched = f.combinations.filter((c) => c.components.some((x) => x.srsTxSwitch !== 0)).length;
			if (switched > 0) errors.push(`${name}: ${switched} combinations set srstxswitch, which is not shown`);
			return [[name, f.combinations.map((c) => c.components.map(component))]];
		});
}

/** `default, endc_common, lte_ca_common`: the base confseqs' layer names, without their scopes. */
function baseLabel(manifest: Manifest, layers: ReadonlyMap<string, NamedLayer>): string {
	const names = manifest.entries.flatMap((e) =>
		e.scope !== "file" && e.base ? [layers.get(e.confseq)?.name.replace(/\.[^.]+$/, "") ?? e.confseq] : [],
	);
	return [...new Set(names)].join(", ");
}

const isBase: Part = (e) => e.base;
const isOwn: Part = (e) => !e.base;
const all: Part = () => true;

export function shannonConfig(files: ArchiveFiles, sha: string): MappedConfig {
	const manifest = decodeManifest(member(files, SHANNON_MANIFEST));
	const defs: ItemDefs = jsonMember(files, ITEMS, itemsSchema);
	const errors: string[] = [];
	const baseErrors: string[] = [];
	const layers = layersOf(files, manifest, (e) => (e.base ? baseErrors : errors));
	const layered = manifest.entries.some((e) => e.scope !== "file" && e.base);
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
		selection: uniqueSims(matchers.flatMap((r) => rowMatcher(r) ?? [])),
		facts: [
			{ label: "Manifest version", value: manifest.version },
			...(manifest.carrierId === 0 ? [] : [{ label: "Carrier id", value: String(manifest.carrierId) }]),
			...matchers.flatMap((r) => unstatedRow(r) ?? []),
		],
		items: partItems(manifest, layers, layered ? isOwn : all, defs, errors),
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
		items: partItems(manifest, layers, isBase, defs, baseErrors),
		combos: [[LTE_CA, baseCa]],
		errors: baseErrors,
	};
	return { config, base };
}
