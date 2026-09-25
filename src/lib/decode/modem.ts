/**
 * Modem package families. An IPSW carries one package per modem it supports:
 * Qualcomm and Intel `Firmware/<Family>-<version>.Release.bbfw`, or an Apple
 * `Firmware/c<chip>…/Release/…/ftab.bin`. Names are that path without
 * `Firmware/` (scripts/modems.py picks the members); the family is read off it.
 */

import type { BasebandSummary } from "./bbfw";
import type { FtabSummary } from "./ftab";

/** What baseband/<id>.json holds. */
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
