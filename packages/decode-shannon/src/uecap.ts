/**
 * UE capability band combinations (`uecapconfig/*.binarypb`). Three layouts, told apart by wire type: `<CARRIER>_<n>`
 * files (EN-DC and NR CA), `lte_<n>` files (LTE CA), and `ap_plmn_mapping` (carrier index → PLMNs). Field names past
 * band and classes follow 3GPP TS 38.331 and a community .proto (jchin14/binarypb-band-editor), matched against the corpus.
 */

import { packedVarints, wireFields, type WireField } from "@carrier-explode/binary";
import { BANDWIDTH_CLASSES, type BandwidthClass, DL_MIMO_LAYERS } from "./classes.ts";
import { type LteCaComponent, lteCaComponent } from "./lte-ca.ts";
import { type Plmn, unpackPlmn } from "./plmn.ts";
import { enumOf, int, required, text, unexpected } from "./wire.ts";

/** Subcarrier spacing in kHz, from 1 (3GPP's SubcarrierSpacing enum plus one). */
const SCS_KHZ = [15, 30, 60, 120, 240] as const;
/** maxNumberMIMO-LayersCB-PUSCH, from 1. */
const UL_MIMO_LAYERS = [1, 2, 4] as const;
/** NR bands are stored as 10000 + n. */
const NR_BAND_BASE = 10000;

/** FeatureSetDownlinkPerCC / FeatureSetUplinkPerCC; a field proto3 leaves out reads 0. */
interface CarrierFeature<Layers extends readonly number[]> {
	readonly scsKHz: (typeof SCS_KHZ)[number];
	readonly bandwidthMHz: number;
	readonly mimoLayers: Layers[number];
	/** maxModOrder: 1 on FR2 and 64QAM-only carriers, 2 for 256QAM. */
	readonly maxModulation: number;
	readonly bandwidth90MHz: boolean;
}
type DlFeature = CarrierFeature<typeof DL_MIMO_LAYERS>;
type UlFeature = CarrierFeature<typeof UL_MIMO_LAYERS> & {
	/** maxNumberMIMO-LayersNonCB-PUSCH. */
	readonly nonCbMimoLayers: number;
};

interface ComponentBase {
	readonly band: number;
	readonly dlClass: BandwidthClass;
	readonly ulClass: BandwidthClass | null;
	/** The band's downlink and uplink FeatureSet ids; 0 for none. */
	readonly dlFeatureSet: number;
	readonly ulFeatureSet: number;
	/** In the community .proto as srstxswitch; 0 in every file seen. */
	readonly srsTxSwitch: number;
}

export type Component =
	| (ComponentBase & { readonly rat: "LTE" })
	/** One feature per carrier of the class, downlink and uplink. */
	| (ComponentBase & {
			readonly rat: "NR";
			readonly dl: readonly DlFeature[];
			readonly ul: readonly UlFeature[];
	  });

/** What a group of combinations shares; 0 where unset. */
export interface ComboHeader {
	/** BandCombinationSet bitmaps (bcsNr, bcsIntraEndc, bcsEutra), most significant bit first. */
	readonly bcsNr: number;
	readonly bcsIntraEndc: number;
	readonly bcsEutra: number;
	/** 1 forces power class 2, by the community .proto. */
	readonly powerClass: number;
	readonly intraBandEnDcSupport: number;
}

export interface UeCapCombination {
	readonly header: ComboHeader;
	/** The band list's field 2 (bitMask in the community .proto): 0 in every file seen. */
	readonly bitMask: number;
	readonly components: readonly Component[];
}

export type UeCapFile =
	/** `combinations` is empty in the placeholder files some carriers have. */
	| {
			readonly kind: "combinations";
			/** Field 1: one of two values across tokay's files. */
			readonly version: number;
			readonly carrierIndex: number;
			/** Field 9: differs per file, unexplained. */
			readonly field9: number;
			readonly combinations: readonly UeCapCombination[];
	  }
	| { readonly kind: "lte-ca"; readonly combinations: readonly (readonly LteCaComponent[])[] }
	| {
			readonly kind: "plmn-map";
			readonly carriers: readonly {
				readonly index: number;
				readonly name: string;
				readonly plmns: readonly Plmn[];
			}[];
	  };

type Message = ReadonlyMap<string, readonly WireField[]>;

/** The fields of a message by key, refusing any key outside `allowed`. */
function message(b: Uint8Array, allowed: readonly WireField["key"][], where: string): Message {
	const m = new Map<string, WireField[]>();
	for (const f of wireFields(b)) {
		if (!allowed.includes(f.key)) unexpected(f, where);
		const seen = m.get(f.key);
		if (seen) seen.push(f);
		else m.set(f.key, [f]);
	}
	return m;
}

const varints = (m: Message, key: `${number}:varint`): number[] =>
	(m.get(key) ?? []).flatMap((f) => (f.wire === "varint" ? [int(f.value, key)] : []));
const bytesOf = (m: Message, key: `${number}:bytes`): Uint8Array[] =>
	(m.get(key) ?? []).flatMap((f) => (f.wire === "bytes" ? [f.value] : []));
/** A singular varint; proto3 leaves 0 out. */
const varint = (m: Message, key: `${number}:varint`): number => varints(m, key).at(-1) ?? 0;

function feature<const L extends readonly number[]>(m: Message, layers: L): CarrierFeature<L> {
	return {
		scsKHz: enumOf(SCS_KHZ, varint(m, "1:varint"), "subcarrier spacing"),
		bandwidthMHz: required(varints(m, "3:varint").at(-1), "bandwidth"),
		mimoLayers: enumOf(layers, varint(m, "2:varint"), "MIMO layers"),
		maxModulation: varint(m, "4:varint"),
		bandwidth90MHz: varint(m, "5:varint") !== 0,
	};
}

const FEATURE_FIELDS = ["1:varint", "2:varint", "3:varint", "4:varint", "5:varint"] as const;

const dlFeature = (b: Uint8Array): DlFeature =>
	feature(message(b, FEATURE_FIELDS, "uecap DL feature"), DL_MIMO_LAYERS);

function ulFeature(b: Uint8Array): UlFeature {
	const m = message(b, [...FEATURE_FIELDS, "6:varint"], "uecap UL feature");
	return { ...feature(m, UL_MIMO_LAYERS), nonCbMimoLayers: varint(m, "6:varint") };
}

const ulClassOf = (v: number): BandwidthClass | null =>
	v === 0 ? null : enumOf(BANDWIDTH_CLASSES, v, "UL class");

/** 1-based indexes into a feature table; 0 (LTE components) points at none. */
function features<F>(b: Uint8Array | undefined, table: readonly F[]): F[] {
	return packedVarints(b ?? new Uint8Array()).flatMap((i) =>
		i === 0n ? [] : [required(table[Number(i) - 1], `feature ${i}`)],
	);
}

function component(b: Uint8Array, dl: readonly DlFeature[], ul: readonly UlFeature[]): Component {
	const m = message(
		b,
		["1:varint", "2:varint", "3:varint", "4:varint", "5:varint", "6:bytes", "7:bytes", "8:varint"],
		"uecap component",
	);
	const stored = required(varints(m, "1:varint").at(-1), "band");
	const base = {
		dlClass: enumOf(BANDWIDTH_CLASSES, varint(m, "2:varint"), "DL class"),
		ulClass: ulClassOf(varint(m, "3:varint")),
		dlFeatureSet: varint(m, "4:varint"),
		ulFeatureSet: varint(m, "5:varint"),
		srsTxSwitch: varint(m, "8:varint"),
	};
	if (stored < NR_BAND_BASE) return { rat: "LTE", band: stored, ...base };
	return {
		rat: "NR",
		band: stored - NR_BAND_BASE,
		...base,
		dl: features(bytesOf(m, "6:bytes").at(-1), dl),
		ul: features(bytesOf(m, "7:bytes").at(-1), ul),
	};
}

function comboHeader(b: Uint8Array | undefined): ComboHeader {
	const m = message(
		b ?? new Uint8Array(),
		["1:varint", "2:varint", "3:varint", "4:varint", "5:varint"],
		"uecap combination header",
	);
	return {
		bcsNr: varint(m, "1:varint"),
		bcsIntraEndc: varint(m, "2:varint"),
		bcsEutra: varint(m, "3:varint"),
		powerClass: varint(m, "4:varint"),
		intraBandEnDcSupport: varint(m, "5:varint"),
	};
}

/** A group of combinations under one header: each band list is a combination (variants differ in FeatureSet ids). */
function combinationGroup(
	b: Uint8Array,
	dl: readonly DlFeature[],
	ul: readonly UlFeature[],
): UeCapCombination[] {
	const m = message(b, ["1:bytes", "2:bytes"], "uecap combination group");
	const header = comboHeader(bytesOf(m, "1:bytes").at(-1));
	return bytesOf(m, "2:bytes").map((list) => {
		const l = message(list, ["1:bytes", "2:varint"], "uecap band list");
		return {
			header,
			bitMask: varint(l, "2:varint"),
			components: bytesOf(l, "1:bytes").map((c) => component(c, dl, ul)),
		};
	});
}

/** Fields 1-3: band, DL class bitmap, UL class bitmap. */
function lteComponent(b: Uint8Array): LteCaComponent {
	const m = message(b, ["1:varint", "2:varint", "3:varint"], "LTE CA component");
	return lteCaComponent(
		required(varints(m, "1:varint").at(-1), "band"),
		varint(m, "2:varint"),
		varint(m, "3:varint"),
	);
}

function plmnCarrier(b: Uint8Array): { index: number; name: string; plmns: Plmn[] } {
	const m = message(b, ["1:varint", "2:varint", "3:bytes"], "PLMN map entry");
	return {
		index: varint(m, "2:varint"),
		name: text(required(bytesOf(m, "3:bytes").at(-1), "carrier name")),
		plmns: varints(m, "1:varint").map(unpackPlmn),
	};
}

export function decodeUeCap(bytes: Uint8Array): UeCapFile {
	const top = [...wireFields(bytes)];
	if (top.some((f) => f.key === "1:bytes")) {
		const m = message(bytes, ["1:bytes"], "PLMN map");
		return { kind: "plmn-map", carriers: bytesOf(m, "1:bytes").map(plmnCarrier) };
	}
	if (top.some((f) => f.key === "2:bytes")) {
		// Field 1 is an id shared across files, 3 a per-file hash; combination fields 2..4 are bitmaps not yet understood.
		const m = message(bytes, ["1:varint", "2:bytes", "3:varint"], "LTE CA file");
		return {
			kind: "lte-ca",
			combinations: bytesOf(m, "2:bytes").map((c) =>
				bytesOf(
					message(c, ["1:bytes", "2:varint", "3:varint", "4:varint"], "LTE CA combination"),
					"1:bytes",
				).map(lteComponent),
			),
		};
	}
	const m = message(
		bytes,
		["1:varint", "2:varint", "3:bytes", "6:bytes", "7:bytes", "9:varint"],
		"uecap file",
	);
	const dl = bytesOf(m, "6:bytes").map(dlFeature);
	const ul = bytesOf(m, "7:bytes").map(ulFeature);
	return {
		kind: "combinations",
		version: varint(m, "1:varint"),
		carrierIndex: varint(m, "2:varint"),
		field9: varint(m, "9:varint"),
		combinations: bytesOf(m, "3:bytes").flatMap((c) => combinationGroup(c, dl, ul)),
	};
}
