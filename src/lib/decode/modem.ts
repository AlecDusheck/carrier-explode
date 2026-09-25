/**
 * Modem package families. An IPSW carries one package per modem it supports:
 * Qualcomm and Intel `Firmware/<Family>-<version>.Release.bbfw`, or an Apple
 * `Firmware/c<chip>…/Release/…/ftab.bin`. Names are that path without
 * `Firmware/` (scripts/modems.py picks the members); the family is read off it.
 */

import type { BasebandSummary } from "./bbfw";
import type { FtabSummary } from "./ftab";
import type { PriDialect } from "./pri";

/**
 * Version of the stored summary shape. It names the storage path (see
 * src/lib/server/modems.ts), so a change the stored summaries must be rebuilt
 * for bumps it and the new ones land beside the old.
 */
export const MODEM_SUMMARY_SCHEMA = 2;

/** A decoded modem package, as stored. */
export type ModemSummary = BasebandSummary | FtabSummary;

export type ModemKind = "bbfw" | "ftab";
export type ModemVendor = "qualcomm" | "intel" | "apple";

/** Apple modem chips by the id their package directory starts with. */
export const APPLE_MODEM_CHIPS: Record<string, string> = { c4000: "C1" };

/** Vendors by bbfw name prefix: Mav25-2.10.01.Release.bbfw, ICE19-8.00.00.Release.bbfw. */
const BBFW_VENDORS: Record<string, ModemVendor> = { Mav: "qualcomm", ICE: "intel" };

const BBFW_NAME = /^([A-Za-z]+)(\d+)-[^/]*\.bbfw$/;
const FTAB_NAME = /^(c\d{4})[^/]*\/(?:.*\/)?ftab\.bin$/;

/** Chip id of an Apple package ("c4000"), from its name. */
export const modemChip = (name: string) => FTAB_NAME.exec(name)?.[1];

/** "Mav25", "ICE19", "C1"; an Apple chip without a known name is its id ("c4020"). */
export function modemFamily(name: string): string | undefined {
  const bbfw = BBFW_NAME.exec(name);
  if (bbfw) return bbfw[1] + bbfw[2];
  const chip = modemChip(name);
  return chip && (Object.hasOwn(APPLE_MODEM_CHIPS, chip) ? APPLE_MODEM_CHIPS[chip] : chip);
}

export function modemVendor(family: string): ModemVendor | undefined {
  const prefix = /^[A-Za-z]+/.exec(family)?.[0] ?? "";
  if (Object.hasOwn(BBFW_VENDORS, prefix)) return BBFW_VENDORS[prefix];
  if (Object.values(APPLE_MODEM_CHIPS).includes(family) || /^c\d{4}$/.test(family)) return "apple";
  return undefined;
}

const VENDOR_NAMES: Record<ModemVendor, string> = { qualcomm: "Qualcomm", intel: "Intel", apple: "Apple" };

/** Marketing names, only where the family is known for certain to be that modem. */
const MODEM_NAMES: Record<string, string> = { Mav25: "X80", Mav24: "X75" };

/** "Qualcomm X80", "Apple C1", "Intel": the modem as sold, as far as it is known. */
export function modemName(family: string): string | undefined {
  const v = modemVendor(family);
  if (!v) return undefined;
  if (v === "apple" && Object.values(APPLE_MODEM_CHIPS).includes(family)) return `Apple ${family}`;
  return Object.hasOwn(MODEM_NAMES, family) ? `${VENDOR_NAMES[v]} ${MODEM_NAMES[family]}` : VENDOR_NAMES[v];
}

/** "Qualcomm X80 · Mav25", "Apple C1", "Intel · ICE19", "Apple · c4020". */
export function modemLabel(family: string): string {
  const name = modemName(family);
  if (!name) return family;
  return name.endsWith(" " + family) ? name : `${name} · ${family}`;
}

export interface ModemCapabilities {
  /** The package ships its carrier defaults as plaintext files a bundle's .der.pri can be compared against. */
  plaintextDefaults: boolean;
  /** Where the modem's carrier config lives: package defaults the bundle overrides, or the bundle alone. */
  carrierConfigIn: "package" | "bundle";
}

const CAPABILITIES: Record<ModemVendor, ModemCapabilities> = {
  qualcomm: { plaintextDefaults: true, carrierConfigIn: "package" },
  intel: { plaintextDefaults: false, carrierConfigIn: "package" },
  apple: { plaintextDefaults: false, carrierConfigIn: "bundle" },
};

/** What a family's package holds, so views need not branch on the vendor. */
export function modemCapabilities(family: string): ModemCapabilities | undefined {
  const v = modemVendor(family);
  return v && CAPABILITIES[v];
}

const DIALECT_LABELS: Record<Exclude<PriDialect, "unknown">, string> = {
  qualcomm: "Qualcomm",
  intel: "Intel or Apple C1",
  mixed: "Qualcomm and Intel / Apple C1",
};

/** The modems a PRI dialect is written for; undefined when the tags do not say. */
export const dialectLabel = (d: PriDialect): string | undefined => (d === "unknown" ? undefined : DIALECT_LABELS[d]);
