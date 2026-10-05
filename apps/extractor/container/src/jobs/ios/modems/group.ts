/** A build's distinct modem packages and the phones using each; the manifest maps boards to packages. */

import { u32Hex } from "@carrier-explode/binary";
import { compareProducts, modemBoards, type BuildManifest } from "@carrier-explode/decode-ios";
import type { ModemPackage } from "@carrier-explode/schema/types";

/** What grouping needs of a zip entry (firmware's ZipEntry has it). */
export interface MemberInfo {
  readonly name: string;
  readonly size: number;
  readonly crc32: number;
}

/** A modem package in an IPSW. `name` is its path under Firmware/, which the decoder reads the family off. */
export interface ModemMember extends Pick<ModemPackage, "name" | "size" | "crc32" | "kind"> {
  /** Path inside the IPSW. */
  readonly member: string;
  /** Boards it is the modem of. */
  readonly boards: readonly string[];
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
      crc32: u32Hex(e.crc32),
      kind: e.name.endsWith(".bbfw") ? "bbfw" : "ftab",
      boards: b,
    });
  }
  return out;
}

/** Packages are the same when name, size and CRC32 are. */
export const packageKey = (p: { readonly name: string; readonly size: number; readonly crc32: string }): string => `${p.name}|${p.size}|${p.crc32}`;

export interface ModemGroup extends ModemMember {
  /** One IPSW it can be read from. */
  readonly url: string;
  /** Phones that use it, oldest first. */
  readonly devices: readonly string[];
}

/** One group per package, newest phone's first. A phone with unknown boards gets every modem of its IPSW. */
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
    // A package no listed phone uses sorts first.
    if (x === undefined || y === undefined) return Number(x !== undefined) - Number(y !== undefined) || ordinal(a.name, b.name);
    return compareProducts(y, x) || ordinal(a.name, b.name);
  });
}
