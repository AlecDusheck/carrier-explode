/** One Qualcomm NV item or EFS file as a ModemItem. Pixel MCFG and iPhone `.der.pri` both call this, so equal bytes give equal items. */

import { bytesToHex, leUint, maybeText } from "@carrier-explode/binary";
import { annotateNv, CCM_FLAG_BYTES, CCM_ITEMS, describeNv, type Confidence, type NvType } from "@carrier-explode/decode-qualcomm";

import type { Certainty, ModemItem, ModemValue } from "../../types.ts";

const CERTAINTY = { high: "high", med: "medium", low: "low" } as const satisfies Record<Confidence, Certainty>;

const TEXT_TYPES: readonly NvType[] = ["string", "text", "xml"];

/** A whole document, with or without the prolog (data_3gpp_dynamic_config.xml has none). */
const XML = /^\s*<(\?xml|[A-Za-z_][\w.-]*[\s/>])[\s\S]*>\s*$/;

/**
 * Bytes as the value they hold: XML, text, a little-endian number or raw bytes. Up to 8 bytes, NUL padding or no
 * word in the text marks a number (0x78 0 0 0 is 120, not "x"), unless the item declares text.
 */
export function modemValue(bytes: Uint8Array, declaresText: boolean): ModemValue {
  const hex = { kind: "bytes", hex: bytesToHex(bytes) } as const;
  const text = maybeText(bytes, Infinity);
  if (text !== undefined && XML.test(text)) return { kind: "xml", value: text };
  if (bytes.length > 8) return text === undefined ? hex : { kind: "text", value: text };
  const word = text !== undefined && text.length > 1 && bytes.at(-1) !== 0 && (/[A-Za-z/:;=_@#-]/.test(text) || /^\d+(\.\d+)+$/.test(text));
  if (text !== undefined && (declaresText || word)) return { kind: "text", value: text };
  const n = leUint(bytes);
  return n === undefined ? hex : { kind: "number", value: n };
}

/** A Carrier Configuration Management group: one 0/1 flag per byte. */
const isCcm = (key: number | string, bytes: Uint8Array): boolean => typeof key === "number" && key in CCM_ITEMS && bytes.length === CCM_FLAG_BYTES;

/** `key`: a legacy NV item number or an EFS path. */
export function qualcommItem(key: number | string, bytes: Uint8Array): ModemItem {
  const info = describeNv(key);
  const id = typeof key === "number" ? `nv:${key}` : `efs:${key}`;
  const certainty = info === undefined ? "opaque" : CERTAINTY[info.confidence];
  if (isCcm(key, bytes)) {
    const set = bytes.filter((b) => b !== 0).length;
    const odd = bytes.some((b) => b > 1) ? ", some not 0/1" : "";
    const value: ModemValue = { kind: "flags", values: [...bytes] };
    return { id, name: info?.name ?? null, description: `${set} of ${CCM_FLAG_BYTES} flags set${odd}`, value, label: null, certainty };
  }
  const value = modemValue(bytes, info !== undefined && TEXT_TYPES.includes(info.type));
  const note = annotateNv(key, value.kind === "number" ? value.value : undefined, bytes);
  return { id, name: info?.name ?? null, description: note?.meaning ?? null, value, label: note?.label ?? null, certainty };
}

/** Items in order with one per id, the last: the modem writes them in order. */
export function lastPerId(items: readonly ModemItem[]): ModemItem[] {
  return [...new Map(items.map((i) => [i.id, i])).values()];
}
