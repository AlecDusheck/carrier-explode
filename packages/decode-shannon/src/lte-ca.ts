/**
 * LTE CA combinations as `lte_<n>` uecap files and `UECAPA_REL10_CA_COMB_<n>_*` confseq items store them: per band, a
 * DL class bitmap (0x8000 is class A, each lower bit the next; bit 0 set for four MIMO layers) and a UL class bitmap.
 */

import { crc32 } from "@carrier-explode/binary";
import { BANDWIDTH_CLASSES, type BandwidthClass, DL_MIMO_LAYERS } from "./classes.ts";
import { enumOf, int, ShannonFormatError } from "./wire.ts";

export interface LteCaComponent {
	readonly band: number;
	readonly dlClass: BandwidthClass;
	readonly ulClass: BandwidthClass | null;
	readonly dlMimoLayers: (typeof DL_MIMO_LAYERS)[number];
}

function classBit(v: number, what: string): BandwidthClass {
	const bit = 31 - Math.clz32(v);
	if (v !== 1 << bit || bit > 15) throw new ShannonFormatError(`${what} 0x${v.toString(16)}`);
	return enumOf(BANDWIDTH_CLASSES, 16 - bit, what);
}

export function lteCaComponent(band: number, dl: number, ul: number): LteCaComponent {
	return {
		band,
		dlClass: classBit(dl & ~1, "DL class"),
		dlMimoLayers: enumOf(DL_MIMO_LAYERS, (dl & 1) + 1, "DL MIMO"),
		ulClass: ul === 0 ? null : classBit(ul, "UL class"),
	};
}

/** An item's values by name, from the confseqs in effect. */
export type ItemLookup = (name: string) => readonly bigint[] | undefined;

export const byName =
	(values: ReadonlyMap<number, readonly bigint[]>): ItemLookup =>
	(name) =>
		values.get(crc32(new TextEncoder().encode(name)));

/** Every band of a confseq combination carries UL 0xFFFF or none does; what it means is not known. */
const UL_UNKNOWN = 0xffff;

export interface ConfseqCaCombinations {
	readonly combinations: readonly (readonly LteCaComponent[])[];
	/** Combinations whose UL bitmaps are all 0xFFFF, left out. */
	readonly unknownUplink: number;
}

/** `UECAPA_REL10_CA_COMB_NUM` combinations, numbered from 1; none when the items are absent. */
export function confseqCaCombinations(item: ItemLookup): ConfseqCaCombinations {
	const total = int(item("UECAPA_REL10_CA_COMB_NUM")?.[0] ?? 0n, "CA combination count");
	const combinations: LteCaComponent[][] = [];
	let unknownUplink = 0;
	for (let n = 1; n <= total; n++) {
		const field = (f: string): number[] => {
			const v = item(`UECAPA_REL10_CA_COMB_${n}_${f}`);
			if (v === undefined) throw new ShannonFormatError(`CA combination ${n} has no ${f}`);
			return v.map((x) => int(x, f));
		};
		const [count = 0] = field("NUM_BAND");
		const bands = field("BAND").slice(0, count);
		const dl = field("DL_BW_CLASS_BIT_MAP").slice(0, count);
		const ul = field("UL_BW_CLASS_BIT_MAP").slice(0, count);
		if (bands.length !== count || dl.length !== count || ul.length !== count)
			throw new ShannonFormatError(`CA combination ${n}: ${count} bands not all given`);
		if (ul.every((x) => x === UL_UNKNOWN)) {
			unknownUplink++;
			continue;
		}
		combinations.push(bands.map((band, i) => lteCaComponent(band, dl[i] ?? 0, ul[i] ?? 0)));
	}
	return { combinations, unknownUplink };
}
