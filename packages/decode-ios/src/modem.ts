/**
 * Modem package families, read off the package's path without `Firmware/`: Qualcomm and Intel
 * `<Family>-<version>.Release.bbfw`, or an Apple `c<chip>…/Release/…/ftab.bin`.
 */

import type { BasebandSummary } from "./baseband-summary.ts";
import type { FtabSummary } from "./ftab.ts";
import type { PriDialect } from "./pri.ts";

/** Names the stored summaries' path: a change they must be rebuilt for bumps it, and new ones land beside the old. */
export const MODEM_SUMMARY_SCHEMA = 3;

/** A decoded modem package, as stored. */
export type ModemSummary = BasebandSummary | FtabSummary;

export type ModemKind = "bbfw" | "ftab";
export type PackageVendor = "qualcomm" | "intel" | "apple";

/** Apple modem chips by the id their package directory starts with. */
const APPLE_MODEM_CHIPS: Record<string, string> = { c4000: "C1" };

/** Vendors by bbfw name prefix: Mav25-2.10.01.Release.bbfw, ICE19-8.00.00.Release.bbfw. */
const BBFW_VENDORS: Record<string, PackageVendor> = { Mav: "qualcomm", ICE: "intel" };

const BBFW_NAME = /^([A-Za-z]+)(\d+)-[^/]*\.bbfw$/;
const FTAB_NAME = /^(c\d{4})[^/]*\/(?:.*\/)?ftab\.bin$/;

/** Chip id of an Apple package ("c4000"), from its name. */
export const modemChip = (name: string): string | undefined => FTAB_NAME.exec(name)?.[1];

/** "Mav25", "ICE19", "C1"; an Apple chip without a known name is its id ("c4020"). */
export function modemGeneration(name: string): string | undefined {
	const bbfw = BBFW_NAME.exec(name);
	if (bbfw) {
		const [, series = "", number = ""] = bbfw;
		return series + number;
	}
	const chip = modemChip(name);
	return chip && (Object.hasOwn(APPLE_MODEM_CHIPS, chip) ? APPLE_MODEM_CHIPS[chip] : chip);
}

export function modemVendor(generation: string): PackageVendor | undefined {
	const prefix = /^[A-Za-z]+/.exec(generation)?.[0] ?? "";
	if (Object.hasOwn(BBFW_VENDORS, prefix)) return BBFW_VENDORS[prefix];
	if (Object.values(APPLE_MODEM_CHIPS).includes(generation) || /^c\d{4}$/.test(generation)) return "apple";
	return undefined;
}

const VENDOR_NAMES: Record<PackageVendor, string> = { qualcomm: "Qualcomm", intel: "Intel", apple: "Apple" };

/** "Qualcomm X80", "Apple C1", "Intel": the modem as sold, by its label where someone has named the generation, else by its vendor. */
export function modemName(generation: string, label: string | undefined): string | undefined {
	if (label !== undefined) return label;
	const v = modemVendor(generation);
	if (!v) return undefined;
	return v === "apple" && Object.values(APPLE_MODEM_CHIPS).includes(generation)
		? `Apple ${generation}`
		: VENDOR_NAMES[v];
}

/** "Qualcomm X80 · Mav25", "Apple C1", "Intel · ICE19", "Apple · c4020". */
export function modemLabel(generation: string, label: string | undefined): string {
	const name = modemName(generation, label);
	if (!name) return generation;
	return name.endsWith(" " + generation) ? name : `${name} · ${generation}`;
}

export interface ModemCapabilities {
	/** The package ships its carrier defaults as plaintext files a bundle's .der.pri can be compared against. */
	plaintextDefaults: boolean;
	/** Where the modem's carrier config lives: package defaults the bundle overrides, or the bundle alone. */
	carrierConfigIn: "package" | "bundle";
}

const CAPABILITIES: Record<PackageVendor, ModemCapabilities> = {
	qualcomm: { plaintextDefaults: true, carrierConfigIn: "package" },
	intel: { plaintextDefaults: false, carrierConfigIn: "package" },
	apple: { plaintextDefaults: false, carrierConfigIn: "bundle" },
};

/** What a generation's package holds, so views need not branch on the vendor. */
export function modemCapabilities(generation: string): ModemCapabilities | undefined {
	const v = modemVendor(generation);
	return v && CAPABILITIES[v];
}

const DIALECT_LABELS: Record<Exclude<PriDialect, "unknown">, string> = {
	qualcomm: "Qualcomm",
	intel: "Intel or Apple C1",
	mixed: "Qualcomm and Intel / Apple C1",
};

/** The modems a PRI dialect is written for; undefined when the tags do not say. */
export const dialectLabel = (d: PriDialect): string | undefined =>
	d === "unknown" ? undefined : DIALECT_LABELS[d];
