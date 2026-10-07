/**
 * Qualcomm MCFG images (an ELF, or a bare segment), their MCFG_TRL trailers, and the built-in configs a modem image
 * (qdsp6sw.mbn) carries as plain segments or zlib streams.
 */

import {
	asciiAt,
	byteAt,
	bytesToHex,
	inflateCapped,
	inflateHead,
	latin1,
	u16le,
	u32le,
} from "@carrier-explode/binary";
import { itemLayout } from "./layouts.ts";

const trimNul = (s: string): string => s.replace(/\0+$/, "");

// MCFG_TRL TLVs: 0 trailer ver | 1 version | 3 label | 4 IINs | 5 base version | 6 PLMNs | 7 capability id | 8 digest | 9 end
const HEX_TLVS = { 0: "trailerVersion", 1: "version", 5: "baseVersion", 7: "capability" } as const;
const TEXT_TLVS = { 3: "label", 8: "digest" } as const;
type HexKind = (typeof HEX_TLVS)[keyof typeof HEX_TLVS];
type TextKind = (typeof TEXT_TLVS)[keyof typeof TEXT_TLVS];
const HEX_KINDS: readonly string[] = Object.values(HEX_TLVS);
const isTlvOf = <T extends object>(table: T, t: number): t is Extract<keyof T, number> => t in table;

/** A PLMN as MCFG stores it, as numbers: a 2-digit MNC reads the same as its zero-padded 3-digit form. */
export interface McfgPlmn {
	readonly mcc: number;
	readonly mnc: number;
}

/** One MCFG_TRL TLV, decoded where its layout is known, with its raw value as hex. */
type McfgTrailerField = { readonly type: number; readonly hex: string } & (
	| { readonly kind: HexKind }
	| { readonly kind: TextKind; readonly text: string }
	| { readonly kind: "iins"; readonly flag: number; readonly iins: readonly number[] }
	| { readonly kind: "plmns"; readonly flag: number; readonly plmns: readonly McfgPlmn[] }
	| { readonly kind: "end" }
	| { readonly kind: "other" }
);

export type McfgTrailerKind = McfgTrailerField["kind"];
type FieldOf<K extends McfgTrailerKind> = McfgTrailerField & { readonly kind: K };

export interface McfgTrailer {
	readonly fields: readonly McfgTrailerField[];
}

/** u8 flag, u8 count, then `count` 4-byte entries; undefined when the value is not that shape. */
function list4<T>(v: Uint8Array, entry: (o: number) => T): { flag: number; entries: T[] } | undefined {
	if (v.length < 2 || v.length !== 2 + 4 * byteAt(v, 1)) return undefined;
	return { flag: byteAt(v, 0), entries: Array.from({ length: byteAt(v, 1) }, (_, i) => entry(2 + 4 * i)) };
}

function decodeTlv(type: number, v: Uint8Array): McfgTrailerField {
	const hex = bytesToHex(v);
	if (isTlvOf(HEX_TLVS, type)) return { type, hex, kind: HEX_TLVS[type] };
	if (isTlvOf(TEXT_TLVS, type)) return { type, hex, kind: TEXT_TLVS[type], text: trimNul(latin1(v)) };
	if (type === 9) return { type, hex, kind: "end" };
	if (type === 4) {
		const l = list4(v, (o) => u32le(v, o));
		if (l) return { type, hex, kind: "iins", flag: l.flag, iins: l.entries };
	}
	if (type === 6) {
		const l = list4(v, (o) => ({ mcc: u16le(v, o), mnc: u16le(v, o + 2) }));
		if (l) return { type, hex, kind: "plmns", flag: l.flag, plmns: l.entries };
	}
	return { type, hex, kind: "other" };
}

/** Trailer item body: u8, u8, u16 length, "MCFG_TRL", then TLVs (u8 type, u16le length, value). */ // MCFG item type 10
export function parseMcfgTrailer(body: Uint8Array): McfgTrailer | undefined {
	if (!asciiAt(body, 4, "MCFG_TRL")) return undefined;
	const fields: McfgTrailerField[] = [];
	for (let o = 12; o + 3 <= body.length;) {
		const t = byteAt(body, o),
			n = u16le(body, o + 1);
		if ((t === 0 && n === 0) || o + 3 + n > body.length) break;
		fields.push(decodeTlv(t, body.subarray(o + 3, o + 3 + n)));
		o += 3 + n;
		if (t === 9) break;
	}
	return { fields };
}

/** The trailer's first field of one kind. */
export function trailerField<K extends McfgTrailerKind>(
	t: McfgTrailer | undefined,
	kind: K,
): FieldOf<K> | undefined {
	return t?.fields.find((f): f is FieldOf<K> => f.kind === kind);
}

/** The trailer's version and text fields by name, each present when the trailer has it. */
export type McfgTrailerSummary = Readonly<Partial<Record<HexKind | TextKind, string>>>;

export function summarizeTrailer(t: McfgTrailer): McfgTrailerSummary {
	const out: Partial<Record<HexKind | TextKind, string>> = {};
	for (const f of t.fields) {
		if ("text" in f) out[f.kind] = f.text;
		else if (isHexField(f)) out[f.kind] = f.hex;
	}
	return out;
}

const isHexField = (f: McfgTrailerField): f is FieldOf<HexKind> => HEX_KINDS.includes(f.kind);

/** Payload bounds within the image passed to parseMcfg. */
interface McfgSpan {
	readonly offset: number;
	readonly length: number;
}

interface McfgItemBase {
	/** Where the item's header starts in the image passed to parseMcfg. */
	readonly offset: number;
	readonly type: number;
	readonly attr: number;
	readonly length: number;
}

/** An NV item, a file item (its data when the item declares some), the trailer, or another item type. */
export type McfgItem = McfgItemBase &
	(
		| { readonly kind: "nv"; readonly nv: number; readonly data: McfgSpan }
		| { readonly kind: "file"; readonly path: string; readonly data?: McfgSpan }
		| { readonly kind: "trailer" }
		| { readonly kind: "other" }
	);

export interface McfgImage {
	/** Where the MCFG segment starts in the image (non-zero inside an ELF). */
	segmentOffset: number;
	format: number;
	cfgType: number;
	cfgTypeName: string;
	numItems: number;
	muxdCarrierIndex: number;
	versionId: number;
	version: string;
	items: McfgItem[];
	trailer?: McfgTrailer;
	/** Bytes from the segment start to the end of the last item. */
	length: number;
}

/** The PT_LOAD segment that starts with "MCFG", or `img` itself for a bare segment. */ // ELF32 program headers
function mcfgSegment(img: Uint8Array): number | undefined {
	if (asciiAt(img, 0, "MCFG")) return 0;
	if (!(img[0] === 0x7f && asciiAt(img, 1, "ELF")) || img[4] !== 1 || img.length < 46) return undefined;
	const phoff = u32le(img, 28),
		phnum = u16le(img, 44);
	for (let i = 0; i < phnum && phoff + 32 * i + 8 <= img.length; i++) {
		const off = u32le(img, phoff + 32 * i + 4);
		if (off + 4 <= img.length && asciiAt(img, off, "MCFG")) return off;
	}
	return undefined;
}

/** File item types whose data length is a u32; the others' is a u16. Type 23 carries MDB files (`/mdb/…`). */
const U32_LENGTH_TYPES: ReadonlySet<number> = new Set([8, 16, 23, 27]);

/**
 * One item at `o` of u32 length `ln`; `body` follows the 8-byte item header. An item whose fields do not fill it
 * exactly is `other`, so a misread layout never yields a value.
 */
function mcfgItem(img: Uint8Array, o: number, ln: number, body: Uint8Array): McfgItem {
	const base = { offset: o, type: byteAt(img, o + 4), attr: byteAt(img, o + 5), length: ln };
	if (base.type === 10) return { ...base, kind: "trailer" };
	if (base.type === 1) {
		// u16 item, u16 data length, data
		if (body.length < 4 || 4 + u16le(body, 2) !== body.length) return { ...base, kind: "other" };
		return { ...base, kind: "nv", nv: u16le(body, 0), data: { offset: o + 12, length: body.length - 4 } };
	}
	if (body[0] === 1 && body[1] === 0 && body.length >= 4) {
		// u16 1, u16 path length, path, then u16 2, data length, data
		const pl = u16le(body, 2);
		const q = 4 + pl;
		if (q > body.length) return { ...base, kind: "other" };
		const path = trimNul(latin1(body.subarray(4, q)));
		if (q === body.length) return { ...base, kind: "file", path };
		const w = U32_LENGTH_TYPES.has(base.type) ? 4 : 2;
		if (body[q] !== 2 || body[q + 1] !== 0 || q + 2 + w > body.length) return { ...base, kind: "other" };
		const dl = w === 4 ? u32le(body, q + 2) : u16le(body, q + 2);
		if (q + 2 + w + dl !== body.length) return { ...base, kind: "other" };
		return { ...base, kind: "file", path, data: { offset: o + 8 + q + 2 + w, length: dl } };
	}
	return { ...base, kind: "other" };
}

/**
 * Header: "MCFG" u16 format, u16 cfg type (0 HW, 1 SW), u32 items, u16 muxd carrier index, u16 spare, version record
 * (u16 id, u16 length, value). Items: u32 length, u8 type, u8 attr, u16 reserved, data; type 1 NV, 2/4/5/8/16/27 file, 10 MCFG_TRL.
 */
export function parseMcfg(img: Uint8Array, maxItems = 4096): McfgImage | undefined {
	const s = mcfgSegment(img);
	if (s === undefined || s + 20 > img.length) return undefined;
	const ct = u16le(img, s + 6);
	const vlen = u16le(img, s + 18);
	const out: McfgImage = {
		segmentOffset: s,
		format: u16le(img, s + 4),
		cfgType: ct,
		cfgTypeName: ct === 0 ? "HW" : ct === 1 ? "SW" : String(ct),
		numItems: u32le(img, s + 8),
		muxdCarrierIndex: u16le(img, s + 12),
		versionId: u16le(img, s + 16),
		version: bytesToHex(img.subarray(s + 20, s + 20 + vlen).toReversed()),
		items: [],
		length: 0,
	};
	const count = Math.min(out.numItems || maxItems, maxItems);
	let o = s + 20 + vlen;
	while (o + 8 <= img.length && out.items.length < count) {
		const ln = u32le(img, o);
		if (ln < 8 || o + ln > img.length) break;
		const body = img.subarray(o + 8, o + ln);
		const it = mcfgItem(img, o, ln, body);
		out.items.push(it);
		o += ln;
		// The trailer is the image's last item.
		if (it.kind === "trailer") {
			const trailer = parseMcfgTrailer(body);
			if (trailer) out.trailer = trailer;
			break;
		}
	}
	out.length = o - s;
	return out;
}

/**
 * Item attribute bits whose effect shows in the payload; others stay unread in `attr`. The firmware logs a subs_mask
 * for MultiSIM items and an index for Indexed ones (qdsp6m.qdb); a value-less item has no bytes past those prefixes.
 */
const MCFG_ATTR = { value: 0x01, subsMask: 0x10, index: 0x20 } as const;

/** An item's payload, past the subscription-mask byte its attributes declare. */
export function mcfgItemData(img: Uint8Array, it: McfgItem): Uint8Array {
	if ((it.kind !== "nv" && it.kind !== "file") || it.data === undefined) return new Uint8Array(0);
	const d = img.subarray(it.data.offset, it.data.offset + it.data.length);
	return it.attr & MCFG_ATTR.subsMask ? d.subarray(1) : d;
}

/** An item's prefix bytes, when it has them, and its value; null when the item carries none. */
export interface McfgSetting {
	readonly subsMask: number | null;
	readonly index: number | null;
	readonly value: Uint8Array | null;
}

/**
 * The subscription mask and index bytes its attributes declare, and an index byte its layout leads with though the
 * attributes do not mark it. Undefined when the payload is too short for them, or a value-less item carries bytes.
 */
export function mcfgSetting(
	img: Uint8Array,
	it: Extract<McfgItem, { readonly kind: "nv" | "file" }>,
): McfgSetting | undefined {
	const d =
		it.data === undefined ? new Uint8Array(0) : img.subarray(it.data.offset, it.data.offset + it.data.length);
	const masked = (it.attr & MCFG_ATTR.subsMask) !== 0;
	const valued = (it.attr & MCFG_ATTR.value) !== 0;
	const indexed =
		(it.attr & MCFG_ATTR.index) !== 0 ||
		(valued && itemLayout(it.kind === "nv" ? it.nv : it.path)?.indexed === true);
	const prefixes = (masked ? 1 : 0) + (indexed ? 1 : 0);
	if (d.length < prefixes) return undefined;
	const subsMask = masked ? byteAt(d, 0) : null;
	const index = indexed ? byteAt(d, prefixes - 1) : null;
	const bytes = d.subarray(prefixes);
	if (valued) return { subsMask, index, value: bytes };
	return bytes.length ? undefined : { subsMask, index, value: null };
}

/** Paths of an image's file items, in order. */
export const itemPaths = (m: McfgImage): string[] =>
	m.items.flatMap((it) => (it.kind === "file" ? [it.path] : []));

export interface ModemConfig {
	/** Offset in the modem image of the zlib stream or the plain MCFG header. */
	offset: number;
	container: "zlib" | "plain";
	/** Inflated length (zlib) or segment length (plain). */
	length: number;
	label?: string;
	image: McfgImage;
	files: Array<{ path: string; data: Uint8Array }>;
}

export const isZlibStart = (b: Uint8Array, o: number): boolean =>
	b[o] === 0x78 && (b[o + 1] === 0x01 || b[o + 1] === 0x5e || b[o + 1] === 0x9c || b[o + 1] === 0xda);

const isImage = (d: Uint8Array): boolean => (d[0] === 0x7f && asciiAt(d, 1, "ELF")) || asciiAt(d, 0, "MCFG");

/** First inflated bytes, or undefined when `b[o..]` is not a zlib stream. */
function probeZlib(b: Uint8Array, o: number): Uint8Array | undefined {
	try {
		return inflateHead(b.subarray(o, o + 512));
	} catch {
		// Most 78 xx byte pairs in a modem image are not zlib streams.
		return undefined;
	}
}

function modemFiles(img: Uint8Array, m: McfgImage): ModemConfig["files"] {
	return m.items.flatMap((it) =>
		it.kind === "file" ? [{ path: it.path, data: mcfgItemData(img, it) }] : [],
	);
}

/** Built-in MCFG images in the modem ELF: plain segments (found by header), and zlib streams that inflate to an ELF or MCFG image. */ // qdsp6sw.mbn
export function scanModemConfigs(b: Uint8Array): ModemConfig[] {
	const out: ModemConfig[] = [];
	for (let o = 0; o + 20 <= b.length; o++) {
		const c = b[o];
		if (c === 0x4d && asciiAt(b, o, "MCFG") && u16le(b, o + 16) === 0x1383 && u16le(b, o + 6) <= 1) {
			// plain segment: header + version record id 0x1383
			const m = parseMcfg(b.subarray(o, Math.min(b.length, o + (16 << 20))), 256);
			if (m?.trailer) {
				// not skipped: its file items can be the zlib images below
				const label = trailerField(m.trailer, "label")?.text || undefined;
				out.push({
					offset: o,
					container: "plain",
					length: m.length,
					...(label ? { label } : {}),
					image: m,
					files: modemFiles(b.subarray(o), m),
				});
			}
		} else if (c === 0x78 && isZlibStart(b, o)) {
			const head = probeZlib(b, o);
			if (!head || head.length < 4 || !isImage(head)) continue;
			let img: Uint8Array;
			try {
				img = inflateCapped(b.subarray(o, o + (4 << 20)), 32 << 20);
			} catch {
				// An image header followed by a stream that breaks or runs past the cap is not a config.
				continue;
			}
			const m = parseMcfg(img);
			if (!m) continue;
			const label =
				trailerField(m.trailer, "label")?.text ?? itemPaths(m).find((path) => path.startsWith("/protected"));
			out.push({
				offset: o,
				container: "zlib",
				length: img.length,
				...(label !== undefined ? { label } : {}),
				image: m,
				files: modemFiles(img, m),
			});
		}
	}
	return out;
}
