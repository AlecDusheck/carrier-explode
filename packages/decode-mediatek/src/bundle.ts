/** The modem image's `md/modem-bundle.img`: an `HBLR` header listing named segments (`md1rom`, `md1dsp`, …). */

import { asciiAt, latin1, slice, u32le } from "@carrier-explode/binary";
import { McfError } from "./errors.ts";

const COUNT_AT = 0x30;
const TABLE_AT = 0x40;
const ENTRY = 0x30;
const NAME_LENGTH = 32;

/** Each segment's bytes by name. */
export function readModemBundle(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
  if (!asciiAt(bytes, 0, "HBLR")) throw new McfError("magic", 0, "not a modem bundle");
  const segments = new Map<string, Uint8Array>();
  for (let i = 0; i < u32le(bytes, COUNT_AT); i++) {
    const at = TABLE_AT + i * ENTRY;
    if (!asciiAt(bytes, at, "SEGM")) throw new McfError("magic", at, "not a bundle segment entry");
    const name = latin1(slice(bytes, at + 4, NAME_LENGTH)).replace(/\0+$/, "");
    const offset = u32le(bytes, at + 4 + NAME_LENGTH);
    const length = u32le(bytes, at + 8 + NAME_LENGTH);
    // The third word equals the second in every bundle read; a difference would mean a packed segment.
    if (u32le(bytes, at + 12 + NAME_LENGTH) !== length) throw new McfError("layout", at, `segment ${name} is not stored whole`);
    segments.set(name, slice(bytes, offset, length));
  }
  return segments;
}
