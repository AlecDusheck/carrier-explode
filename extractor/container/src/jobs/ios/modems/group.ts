/**
 * Modem packages of a build, one entry per distinct package however many
 * IPSWs and phones share it: a port of modem_members and group in
 * scripts/modems.py. Pure.
 *
 * Each iPhone IPSW carries the package for its modem: Firmware/<Family>-<v>.Release.bbfw
 * (Qualcomm, Intel) or Firmware/c<chip>…/Release/…/ftab.bin (Apple C1). Its
 * BuildManifest names it per board, which is how an IPSW shared by several
 * phones says which modem each one has.
 */

import { compareProducts, type ModemKind } from "../../../../../../src/lib/decode/index.ts";
import type { BuildManifest } from "../shared/build-manifest.ts";
import { modemBoards } from "../shared/build-manifest.ts";

/** What grouping needs of a zip entry (src/lib/firmware ZipEntry has it). */
export interface MemberInfo {
  readonly name: string;
  readonly size: number;
  readonly crc32: number;
}

export interface ModemMember {
  /** Path inside the IPSW. */
  readonly member: string;
  /** The path under Firmware/, which the decoder reads the family off: `Mav25-2.10.01.Release.bbfw`. */
  readonly name: string;
  readonly size: number;
  /** Lower-case hex, 8 digits. */
  readonly crc32: string;
  readonly kind: ModemKind;
  /** Boards it is the modem of. */
  readonly boards: readonly string[];
}

const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");

/** Modem packages among an IPSW's entries: only what its manifest names as a modem. */
export function modemMembers(entries: readonly MemberInfo[], manifest: BuildManifest): ModemMember[] {
  const boards = modemBoards(manifest);
  const out: ModemMember[] = [];
  for (const e of entries) {
    const b = boards.get(e.name);
    if (!b) continue;
    out.push({
      member: e.name,
      name: e.name.replace(/^Firmware\//, ""),
      size: e.size,
      crc32: hex8(e.crc32),
      kind: e.name.endsWith(".bbfw") ? "bbfw" : "ftab",
      boards: b,
    });
  }
  return out;
}

/** Packages are the same when name, size and CRC32 are: the identity the v1 indexes deduplicated on. */
export const packageKey = (p: { readonly name: string; readonly size: number; readonly crc32: string }): string => `${p.name}|${p.size}|${p.crc32}`;

export interface ModemGroup extends ModemMember {
  /** One IPSW it can be read from. */
  readonly url: string;
  /** Phones that use it, oldest first. */
  readonly devices: readonly string[];
}

/**
 * One group per distinct package: `ipsws` maps IPSW URL -> the phones it serves,
 * `listings` URL -> its modemMembers, `boards` phone -> its boards. A phone whose
 * boards are not known gets every modem of its IPSW. The newest phone's first.
 */
export function group(
  ipsws: ReadonlyMap<string, readonly string[]>,
  listings: ReadonlyMap<string, readonly ModemMember[]>,
  boards: ReadonlyMap<string, readonly string[]>,
): ModemGroup[] {
  const out = new Map<string, ModemGroup>();
  for (const url of [...listings.keys()].sort()) {
    for (const m of listings.get(url) ?? []) {
      const mine = (ipsws.get(url) ?? []).filter((d) => {
        const b = boards.get(d);
        return !b || b.some((x) => m.boards.includes(x));
      });
      const k = packageKey(m);
      const g = out.get(k) ?? { ...m, url, devices: [] };
      out.set(k, { ...g, devices: [...new Set([...g.devices, ...mine])].sort(compareProducts) });
    }
  }
  const newest = (g: ModemGroup): string | undefined => g.devices.at(-1);
  return [...out.values()].sort((a, b) => {
    const x = newest(a);
    const y = newest(b);
    // A package no listed phone uses sorts first, as v1's sort key put it.
    if (x === undefined || y === undefined) return Number(x !== undefined) - Number(y !== undefined) || a.name.localeCompare(b.name);
    return compareProducts(y, x) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
}
