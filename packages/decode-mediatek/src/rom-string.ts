/** The strings md1rom's tables point at. */

import { latin1 } from "@carrier-explode/binary";

/** md1rom's load address: every name pointer of its tables resolves to a string under it. */
const ROM_BASE = 0x9000_0000;

/** The printable, space-free, NUL-terminated string at a pointer, if one is there. */
export function romString(rom: Uint8Array, pointer: number): string | undefined {
  const at = pointer - ROM_BASE;
  if (at < 0 || at >= rom.length) return undefined;
  const end = rom.indexOf(0, at);
  if (end <= at) return undefined;
  const name = latin1(rom.subarray(at, end));
  return /^[\x21-\x7e]+$/.test(name) ? name : undefined;
}
