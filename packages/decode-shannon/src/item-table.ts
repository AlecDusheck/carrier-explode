/**
 * The config item registry in the modem firmware (`modem.bin`): every item's name, element type and element
 * count. Confseqs key items by the CRC-32 of the name; no file in carrierconfig holds the names.
 */

import { crc32, latin1, u32le } from "@carrier-explode/binary";
import { ShannonFormatError } from "./wire.ts";

/** Element types, as the registry names them. */
export const ITEM_TYPES = ["u8", "s8", "u16", "s16", "u32", "s32", "u64", "s64", "bool", "uint", "char"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Bytes per element. */
export const ITEM_TYPE_SIZES = {
  u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, s32: 4, u64: 8, s64: 8, bool: 4, uint: 4, char: 1,
} as const satisfies Readonly<Record<ItemType, number>>;

export interface ItemDef {
  readonly name: string;
  readonly type: ItemType;
  /** Elements one confseq value holds at most: the count over the copies, rounded down. */
  readonly capacity: number;
}

const isItemType = (s: string): s is ItemType => ITEM_TYPES.some((t) => t === s);

/** The image's table of contents: 32-byte entries of a 12-byte name, then file offset, load address, size, CRC and index. */
const TOC_ENTRY = 0x20;
const TOC_NAME = 12;

interface Segment {
  readonly offset: number;
  readonly address: number;
  readonly end: number;
}

function mainSegment(image: Uint8Array): Segment {
  const tocSize = u32le(image, 20);
  for (let at = 0; at + TOC_ENTRY <= tocSize; at += TOC_ENTRY) {
    if (latin1(image.subarray(at, at + TOC_NAME)).replace(/\0+$/, "") !== "MAIN") continue;
    const offset = u32le(image, at + 12);
    return { offset, address: u32le(image, at + 16), end: Math.min(image.length, offset + u32le(image, at + 20)) };
  }
  throw new ShannonFormatError("modem image: no MAIN segment in its table of contents");
}

const printable = (x: number): boolean => x >= 0x20 && x < 0x7f;
const MAX_NAME = 256;

/**
 * Registry entries are 16 bytes: name pointer, element size, a word of copies (bits 0-7), element count over
 * all copies (8-23) and a flag (24-31, set only on calibration items), then a pointer to the type's name.
 */
const ENTRY = 16;
/** Fewer entries in a row are some other table. */
const MIN_REGISTRY = 1000;

interface Entry {
  readonly name: Uint8Array;
  readonly type: ItemType;
  readonly capacity: number;
}

/** Each item the registry defines, by the CRC-32 of its name. */
export function itemTable(image: Uint8Array): ReadonlyMap<number, ItemDef> {
  const main = mainSegment(image);
  /** The NUL-terminated printable string at a MAIN address. */
  const cString = (address: number): Uint8Array | undefined => {
    const start = main.offset + address - main.address;
    if (address < main.address || start >= main.end) return undefined;
    let i = start;
    while (i < main.end && i - start <= MAX_NAME && printable(image[i] ?? 0)) i++;
    return i > start && image[i] === 0 ? image.subarray(start, i) : undefined;
  };

  const typeAt = new Map<number, ItemType>();
  for (let i = main.offset; i + 1 < main.end; i++) {
    if (image[i] !== 0) continue;
    const address = main.address + i + 1 - main.offset;
    const s = cString(address);
    if (s !== undefined && s.length <= 4) {
      const name = latin1(s);
      if (isItemType(name)) typeAt.set(address, name);
    }
  }

  const entry = (o: number): Entry | undefined => {
    if (o + ENTRY > main.end) return undefined;
    const type = typeAt.get(u32le(image, o + 12));
    if (type === undefined || u32le(image, o + 4) !== ITEM_TYPE_SIZES[type]) return undefined;
    const shape = u32le(image, o + 8);
    const copies = shape & 0xff;
    const count = (shape >>> 8) & 0xffff;
    if (copies === 0 || shape >>> 24 > 1) return undefined;
    const name = cString(u32le(image, o));
    return name === undefined ? undefined : { name, type, capacity: Math.floor(count / copies) };
  };

  let best: Entry[] = [];
  for (let o = main.offset; o + ENTRY <= main.end;) {
    const run: Entry[] = [];
    for (let e = entry(o); e !== undefined; e = entry(o)) {
      run.push(e);
      o += ENTRY;
    }
    if (run.length > best.length) best = run;
    if (run.length === 0) o += 4;
  }
  if (best.length < MIN_REGISTRY) throw new ShannonFormatError(`modem image: no item registry (longest run ${best.length} entries)`);

  const table = new Map<number, ItemDef>();
  for (const e of best) {
    const hash = crc32(e.name);
    const def = { name: latin1(e.name), type: e.type, capacity: e.capacity };
    const other = table.get(hash);
    if (other !== undefined && other.name !== def.name) throw new ShannonFormatError(`item registry: ${other.name} and ${def.name} share CRC-32 ${hash}`);
    table.set(hash, def);
  }
  return table;
}
