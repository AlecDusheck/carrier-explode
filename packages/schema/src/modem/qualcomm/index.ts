/** Pixel MCFG (`mcfg_sw.mbn`, its selection records, optionally mcfg_hw's band combos) -> ModemConfig. */

import { canonical } from "@carrier-explode/values";
import * as v from "valibot";

import { bytesToHex } from "@carrier-explode/binary";
import {
	describeNv,
	itemLayout,
	layoutSize,
	mcfgSetting,
	parseBandCombos,
	parseCombo,
	parseMcfg,
	parsePlmnCombos,
	readLayout,
	readMdb,
	SELECTION_MATCHERS,
	trailerField,
	type ComboComponent,
	type McfgCondition,
	type McfgImage,
	type McfgItem,
	type McfgSetting,
	type McfgTrailer,
	type NvLayout,
	type SelectionMatcher,
	type SelectionRecord,
	type SelectionRule,
} from "@carrier-explode/decode-qualcomm";

import { simMatcher, uniqueSims } from "../../sims.ts";
import type { BandComponent, ModemItem, ModemScope, ModemValue, SimMatcher } from "../../types.ts";
import {
	jsonMember,
	member,
	readOr,
	type ArchiveFiles,
	type ConfigDraft,
	type MappedConfig,
} from "../archive.ts";
import type { ComboSource } from "../combos.ts";
import { qualcommItem } from "./items.ts";

export const QUALCOMM_IMAGE = "mcfg_sw.mbn";

/** EFS of the NR5G subsystem (`/nv/item_files/modem/nr5g/RRC/...`), which only a 5G modem's configuration sets. */
export const isNrItem = (item: Pick<ModemItem, "id">): boolean => /\/nr5g\//i.test(item.id);
const SELECTION = "selection.json";
const BAND_COMBOS = "band_combos_per_plmn.xml";

const ruleSchema: v.GenericSchema<SelectionRule> = v.lazy(() =>
	v.variant("kind", [
		v.object({ kind: v.literal("always") }),
		v.object({ kind: v.picklist(["any", "all"]), rules: v.array(ruleSchema) }),
		v.object({
			kind: v.literal("match"),
			matcher: v.picklist(SELECTION_MATCHERS),
			variable: v.string(),
			values: v.array(v.string()),
		}),
	]),
);

const selectionSchema = v.array(
	v.object({
		carrierName: v.string(),
		carrierIndex: v.number(),
		rule: ruleSchema,
		options: v.record(v.string(), v.string()),
	}) satisfies v.GenericSchema<unknown, SelectionRecord>,
);

/** One way to satisfy a rule: the SIM fields it pins, and whether it needs a test a SimMatcher cannot state. */
interface Conjunct {
	readonly mccmnc?: string;
	readonly iccidPrefix?: string;
	readonly gid1?: string;
	readonly inexpressible: boolean;
}

const ANY: Conjunct = { inexpressible: false };

function leaf(matcher: SelectionMatcher, value: string): Conjunct {
	switch (matcher) {
		case "imsi_3gpp_plmn_in":
			return { mccmnc: value.replace("-", ""), inexpressible: false };
		case "iin_in":
			return { iccidPrefix: value, inexpressible: false };
		case "gid_in":
			return { gid1: value, inexpressible: false };
		// A CDMA IMSI's network is not what SimMatcher.mccmnc means.
		case "imsi_3gpp2_plmn_in":
		case "customid_in":
		case "impi_in":
			return { inexpressible: true };
	}
}

/** Two conjuncts that pin one field differently can never both hold. */
function both(a: Conjunct, b: Conjunct): Conjunct | undefined {
	const fields = ["mccmnc", "iccidPrefix", "gid1"] as const;
	if (fields.some((f) => a[f] !== undefined && b[f] !== undefined && a[f] !== b[f])) return undefined;
	return { ...a, ...b, inexpressible: a.inexpressible || b.inexpressible };
}

/** The rule in disjunctive normal form. */
function conjuncts(r: SelectionRule): Conjunct[] {
	switch (r.kind) {
		case "always":
			return [ANY];
		case "match":
			return r.values.map((x) => leaf(r.matcher, x));
		case "any":
			return r.rules.flatMap(conjuncts);
		case "all":
			return r.rules.reduce<Conjunct[]>(
				(acc, x) => acc.flatMap((a) => conjuncts(x).flatMap((c) => both(a, c) ?? [])),
				[ANY],
			);
	}
}

/** The rules' SIM matchers; ways in by ICCID or IMPI alone, by custom id or by CDMA IMSI have no SimMatcher and are left out. */
export function selectionSims(records: readonly SelectionRecord[]): SimMatcher[] {
	return uniqueSims(
		records
			.flatMap((r) => conjuncts(r.rule))
			.flatMap((c) => {
				if (c.inexpressible || c.mccmnc === undefined) return [];
				return simMatcher({ mccmnc: c.mccmnc, iccidPrefix: c.iccidPrefix, gid1: c.gid1 }) ?? [];
			}),
	);
}

/** `A`, `A[4]`, `C[2,2]` (per carrier), `A[4:30]`: the class, then the most MIMO layers given; what follows `:` is not read. */
function bandClass(s: string): { readonly cls: string; readonly layers?: number } {
	const m = /^([A-Z])(?:\[(\d+(?:,\d+)*)(?::\d+)?\])?$/.exec(s);
	if (m === null || m[1] === undefined) throw new Error(`band combo class ${s}`);
	return m[2] === undefined ? { cls: m[1] } : { cls: m[1], layers: Math.max(...m[2].split(",").map(Number)) };
}

function component(c: ComboComponent): BandComponent {
	const dl = bandClass(c.dl);
	return {
		band: `${c.rat === "nr" ? "n" : "B"}${c.band}`,
		dl: dl.cls,
		...(c.ul === undefined ? {} : { ul: bandClass(c.ul).cls }),
		...(dl.layers === undefined ? {} : { dlLayers: dl.layers }),
	};
}

/** The sections listed under the PLMNs the config is selected by, one source per carrier tag. */
function combinations(xml: string, selection: readonly SimMatcher[]): ComboSource[] {
	const plmns = new Set(selection.map((m) => m.mccmnc));
	return parseBandCombos(xml)
		.filter((c) => c.plmns.some((p) => plmns.has(p.replace("-", ""))))
		.map((c): ComboSource => [
			`${BAND_COMBOS}: ${c.tag}`,
			c.combos.map((s) => parseCombo(s).components.map(component)),
		]);
}

/** No selection record names it, or one selects it whatever the SIM (`ROW`): the firmware's own. */
const scopeOf = (records: readonly SelectionRecord[]): ModemScope =>
	records.length === 0 || records.some((r) => r.rule.kind === "always") ? "firmware" : "carrier";

/** What the image holds that is not read: items cut short. */
function unread(mcfg: McfgImage): string[] {
	return mcfg.items.length < mcfg.numItems
		? [`${QUALCOMM_IMAGE}: ${mcfg.numItems} items declared, ${mcfg.items.length} read`]
		: [];
}

/** Every subscription: the mask on all but a few lab and multi-SIM Pixel items. */
const ALL_SUBS = 0x07;

/**
 * An item's id: its target, then a non-zero index and a mask narrower than every subscription. The bare id is the
 * first entry for all subscriptions, as an iPhone override names it.
 */
function settingId(key: number | string, s: McfgSetting): string {
	const base = typeof key === "number" ? `nv:${key}` : `efs:${key}`;
	return `${base}${s.index ? `/${s.index}` : ""}${s.subsMask === null || s.subsMask === ALL_SUBS ? "" : `@${s.subsMask}`}`;
}

/** A value of a layout's exact size as its fields, the rest as qualcommItem reads them. */
function setItem(
	key: number | string,
	id: string,
	bytes: Uint8Array,
	layout: NvLayout | undefined,
	errors: string[],
): ModemItem {
	const item = { ...qualcommItem(key, bytes), id };
	if (layout === undefined) return item;
	const fields = readLayout(layout, bytes);
	if (fields === undefined) {
		errors.push(`${id}: ${bytes.length} bytes where its layout has ${layoutSize(layout)}; shown as stored`);
		return { ...item, value: { kind: "bytes", hex: bytesToHex(bytes) }, label: null };
	}
	const entries = Object.entries(fields);
	if (entries.length === 1 && typeof entries[0]?.[1] === "number") return item;
	return {
		...item,
		value: {
			kind: "fields",
			fields: Object.fromEntries(entries.map(([k, field]) => [k, fieldValue(field)])),
		},
		label: null,
	};
}

const numberValue = (n: number): ModemValue => ({ kind: "number", value: n });

const fieldValue = (field: number | readonly number[]): ModemValue =>
	typeof field === "number" ? numberValue(field) : { kind: "list", values: field.map(numberValue) };

/** An item as stored, when it is of no kind the reader knows or its attributes do not fit its bytes. */
function rawItem(id: string, name: string, hex: string): ModemItem {
	return { id, name, description: null, value: { kind: "bytes", hex }, label: null, certainty: "opaque" };
}

type McfgBranchItem = Extract<McfgItem, { readonly kind: "branch" }>;

/** What a branch adds to the ids of the items it governs: `?if=0 53FF`, `?else`; nothing past its group's end. */
function branchSuffix(b: McfgBranchItem): string {
	if (b.branch === "end") return "";
	const tests = b.conditions.map((c) => c.text).join(" & ");
	return tests === "" ? `?${b.branch}` : `?${b.branch}=${tests}`;
}

const conditionValue = (c: McfgCondition): ModemValue => ({
	kind: "fields",
	fields: {
		type: numberValue(c.type),
		word: numberValue(c.word),
		form: numberValue(c.form),
		text: { kind: "text", value: c.text },
	},
});

function branchItem(i: number, b: McfgBranchItem): ModemItem {
	return {
		id: `mcfg:${i}`,
		name: "Branch on the SIM",
		description:
			"Item type 12: the items after it, up to the next branch, apply only when it holds; a type 2 condition reads as subscription and GID1",
		value: {
			kind: "fields",
			fields: {
				branch: { kind: "text", value: b.branch },
				conditions: { kind: "list", values: b.conditions.map(conditionValue) },
				lead: { kind: "bytes", hex: b.lead },
			},
		},
		label: null,
		certainty: "low",
	};
}

/**
 * Each item as a ModemItem, the last write of an id under it: the modem writes them in order. One inside a branch has
 * the branch in its id, so its group's alternatives stay apart; an earlier write a later one changes keeps its value as
 * `<id>?item <n>`, its index in the file (an MVNO config writes its parent's items, then its own).
 */
function mcfgItems(img: Uint8Array, mcfg: McfgImage, errors: string[]): ModemItem[] {
	let suffix = "";
	const writes = mcfg.items.flatMap((it, i): Array<{ readonly item: ModemItem; readonly index: number }> => {
		if (it.kind === "trailer") return [];
		if (it.kind === "branch") {
			suffix = branchSuffix(it);
			return [{ item: branchItem(i, it), index: i }];
		}
		return mcfgItem(img, it, i, errors).map((item) => ({
			item: { ...item, id: `${item.id}${suffix}` },
			index: i,
		}));
	});
	const last = new Map(writes.map((w) => [w.item.id, w.item]));
	return writes.flatMap(({ item, index }): ModemItem[] => {
		const final = last.get(item.id);
		if (final === item) return [item];
		if (final !== undefined && canonical(final.value) === canonical(item.value)) return [];
		const description = item.description === null ? REPLACED : `${REPLACED}. ${item.description}`;
		return [{ ...item, id: `${item.id}?item ${index}`, description }];
	});
}

const REPLACED = "Written earlier in the file and replaced by a later write";

function mcfgItem(
	img: Uint8Array,
	it: Exclude<McfgItem, { readonly kind: "trailer" | "branch" }>,
	i: number,
	errors: string[],
): ModemItem[] {
	if (it.kind === "other") {
		errors.push(`${QUALCOMM_IMAGE}: item ${i} of type ${it.type} not read`);
		return [
			rawItem(
				`mcfg:${i}`,
				`Item type ${it.type}`,
				bytesToHex(img.subarray(it.offset, it.offset + it.length)),
			),
		];
	}
	const key = it.kind === "nv" ? it.nv : it.path;
	const layout = itemLayout(key);
	const s = mcfgSetting(img, it);
	if (s === undefined) {
		const id = typeof key === "number" ? `nv:${key}` : `efs:${key}`;
		errors.push(`${id}: attributes 0x${it.attr.toString(16)} do not fit its bytes; shown as stored`);
		const raw =
			it.data === undefined
				? new Uint8Array(0)
				: img.subarray(it.data.offset, it.data.offset + it.data.length);
		return [rawItem(id, describeNv(key)?.name ?? id, bytesToHex(raw))];
	}
	const id = settingId(key, s);
	if (s.value !== null) return [setItem(key, id, s.value, layout?.fields, errors)];
	return [
		{ ...qualcommItem(key, new Uint8Array(0)), id, value: { kind: "bytes", hex: "" }, label: "No value" },
	];
}

/** A version TLV's bytes as the u32 they hold. */
const u32Hex = (hex: string): string => `0x${(hex.match(/../g) ?? []).toReversed().join("")}`;

/** A trailer field as a fact: what the config was built for, not what selects it. The label is the config's own. */
function trailerFact(f: McfgTrailer["fields"][number]): Array<{ label: string; value: string }> {
	switch (f.kind) {
		case "label":
		case "end":
			return [];
		case "trailerVersion":
			return [{ label: "Trailer version", value: f.hex }];
		case "version":
			return [{ label: "Version", value: u32Hex(f.hex) }];
		case "baseVersion":
			return [{ label: "Base version", value: u32Hex(f.hex) }];
		case "capability":
			return [{ label: "Capability id", value: u32Hex(f.hex) }];
		case "iins":
			return [{ label: "Built for IINs", value: `${f.iins.join(", ") || "none listed"} (flag ${f.flag})` }];
		case "plmns": {
			const plmns = f.plmns.map((p) => `${p.mcc}-${String(p.mnc).padStart(2, "0")}`);
			return [{ label: "Built for PLMNs", value: `${plmns.join(", ") || "none listed"} (flag ${f.flag})` }];
		}
		case "applicableMccMnc":
			return [{ label: "Applicable MCC-MNC", value: f.values.join(", ") }];
		case "field8":
		case "other":
			return [{ label: `Trailer field ${f.type}`, value: f.hex }];
	}
}

/** What the image's per-PLMN combination MDBs list, one source per record. */
function mdbCombos(img: Uint8Array, mcfg: McfgImage, errors: string[]): ComboSource[] {
	return mcfg.items.flatMap((it): ComboSource[] => {
		if (it.kind !== "file" || !it.path.includes("/plmn2cacombos")) return [];
		const bytes = mcfgSetting(img, it)?.value;
		if (bytes === undefined || bytes === null) return [];
		return readOr(errors, it.path, [], () =>
			parsePlmnCombos(readMdb(bytes)).map((r): ComboSource => [
				`${it.path}: ${r.plmns.join(" ")}`,
				r.combos.map((c) => parseCombo(c).components.map(component)),
			]),
		);
	});
}

export function qualcommConfig(files: ArchiveFiles, sha: string): MappedConfig {
	const img = member(files, QUALCOMM_IMAGE);
	const mcfg = parseMcfg(img);
	if (mcfg === undefined) throw new Error(`${QUALCOMM_IMAGE}: not an MCFG image`);
	const label = trailerField(mcfg.trailer, "label")?.text;
	if (label === undefined) throw new Error(`${QUALCOMM_IMAGE}: no trailer label`);
	const records = jsonMember(files, SELECTION, selectionSchema);
	const selection = selectionSims(records);
	const combos = files.get(BAND_COMBOS);
	const errors = unread(mcfg);
	const config: ConfigDraft = {
		family: "qualcomm",
		sha,
		label,
		scope: scopeOf(records),
		selection,
		facts: (mcfg.trailer?.fields ?? []).flatMap(trailerFact),
		items: mcfgItems(img, mcfg, errors),
		combos: [
			...(combos === undefined
				? []
				: readOr(errors, BAND_COMBOS, [], () => combinations(new TextDecoder().decode(combos), selection))),
			...mdbCombos(img, mcfg, errors),
		],
		errors,
	};
	return { config, base: null };
}
