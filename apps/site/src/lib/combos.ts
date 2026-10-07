/** Band combinations as the combo table shows them, from Qualcomm's combo strings or the neutral model's components. */

import { bandList, parseCombo, type ComboComponent, type ComboType } from "@carrier-explode/decode-qualcomm";
import type { BandCombination, BandComponent } from "@carrier-explode/schema/types";

/** "n77A", "b66A↑A": one band-combo component, with its uplink class unless `uplink` is off. */
export const comboPart = (c: ComboComponent, uplink = true): string =>
	bandList([c.band], c.rat) + c.dl + (uplink && c.ul ? "↑" + c.ul : "");

/** One band of a combination: its number, for the band filter, and how it is written. */
export interface ComboCell {
	readonly band: number;
	readonly text: string;
}

export interface ComboRow {
	readonly text: string;
	readonly lte: readonly ComboCell[];
	readonly nr: readonly ComboCell[];
	/** `NR-DC`, `SWUL`. */
	readonly tags: readonly string[];
}

/** EN-DC (LTE + NR), NR only, or LTE only; parseCombo's rule, for rows from either source. */
export function comboType(r: Pick<ComboRow, "lte" | "nr">): ComboType | undefined {
	if (r.lte.length && r.nr.length) return "endc";
	if (r.nr.length) return "nr";
	return r.lte.length ? "lte" : undefined;
}

const qualcommCell = (c: ComboComponent): ComboCell => ({ band: c.band, text: comboPart(c) });

/** band_combos_per_plmn.xml strings (`b66AA-b2A-n77AA-swul`). */
export const qualcommRows = (combos: readonly string[]): ComboRow[] =>
	combos.map((text) => {
		const c = parseCombo(text);
		return {
			text,
			lte: c.components.filter((x) => x.rat === "lte").map(qualcommCell),
			nr: c.components.filter((x) => x.rat === "nr").map(qualcommCell),
			tags: [...(c.nrdc ? ["NR-DC"] : []), ...(c.swul ? ["SWUL"] : [])],
		};
	});

const BAND = /^([Bn])(\d+)$/;

/** `n41A[4]↑A`: the classes, with the layers in Qualcomm's bracket notation. */
const classText = (c: BandComponent): string =>
	c.band +
	c.dl +
	(c.dlLayers === undefined ? "" : `[${c.dlLayers}]`) +
	(c.ul === undefined ? "" : "↑" + c.ul);

/** The classes, then the bandwidth and subcarrier spacing where the family states them. */
const cellText = (c: BandComponent): string =>
	[
		classText(c),
		...(c.bandwidthMhz === undefined ? [] : [`${c.bandwidthMhz}MHz`]),
		...(c.scsKhz === undefined ? [] : [`${c.scsKhz}kHz`]),
	].join(" ");

/** A stored list of band combinations, any family. */
export const combinationRows = (combos: readonly BandCombination[]): ComboRow[] =>
	combos.map((combo) => {
		const lte: ComboCell[] = [],
			nr: ComboCell[] = [];
		for (const c of combo) {
			const m = BAND.exec(c.band);
			if (!m) throw new Error(`not a band: ${c.band}`);
			(m[1] === "B" ? lte : nr).push({ band: Number(m[2]), text: cellText(c) });
		}
		return { text: combo.map(classText).join("-"), lte, nr, tags: [] };
	});
