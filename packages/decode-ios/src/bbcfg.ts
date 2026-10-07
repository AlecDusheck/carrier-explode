/**
 * BBCFGMBN containers (bbcfg.mbn, pt.mbn) of Apple Qualcomm baseband packages: header, metadata, variant index,
 * blob table, and each blob's NV/EFS records or MAVZ image. Nothing is decrypted or verified.
 */

import { asciiAt, beBigInt, inflateExact, latin1, u32le } from "@carrier-explode/binary";
import { readTlv, type Tlv } from "./der.ts";
import { type Confidence, type McfgImage, parseMcfg } from "@carrier-explode/decode-qualcomm";

const uint = (b: Uint8Array): number => Number(beBigInt(b));
const trimNul = (s: string): string => s.replace(/\0+$/, "");

function* kids(b: Uint8Array, t: Tlv): Generator<Tlv> {
	for (let p = t.contentStart; p < t.contentEnd;) {
		const c = readTlv(b, p, t.contentEnd);
		yield c;
		p = c.end;
	}
}
const ctx = (t: Tlv, num: number): boolean => t.cls === 2 && t.num === num;
const val = (b: Uint8Array, t: Tlv): Uint8Array => b.subarray(t.contentStart, t.contentEnd);

export interface BbcfgMeta {
	project?: string;
	/** "020A0100" = 2.10.01 */
	versionHex?: string;
	/** Same as Info.plist Baseband.Version. */
	version?: string;
	buildHost?: string;
	buildUser?: string;
	field84?: string;
	field85?: string;
	buildTime?: string;
	sourceRevision?: string;
}

// bbcfg.mbn: header tags 80..87 (82..87 are build-system placeholders)
const META_KEYS = [
	"project",
	"versionHex",
	"buildHost",
	"buildUser",
	"field84",
	"field85",
	"buildTime",
	"sourceRevision",
] as const;

export interface FileTypeInfo {
	name: string;
	confidence: Confidence;
	note: string;
}

// qdsp6sw.mbn: log table "DFLT_CAL STAT_NV PA_CHAR STAT_CFG RFFE_DEV RFFE_LUT RFC_MMW PROT_NV PROT_PRI PROT SKU", matched by content
export const BBCFG_FILE_TYPES: Record<number, FileTypeInfo> = {
	1: { name: "DFLT_CAL?", confidence: "low", note: "RF defaults/calibration NV list, VTNV/zlib values" },
	4: { name: "STAT_NV?", confidence: "low", note: "RF static NV list" },
	7: {
		name: "STAT_CFG?",
		confidence: "med",
		note: "MAVZ MCFG HW image, /rfc/<id>_0_{res,cmn}.dat (sub-6 RF card)",
	},
	8: { name: "RFFE_DEV", confidence: "high", note: "EFS /rfc/device_settings/*" },
	9: { name: "RFFE_LUT", confidence: "high", note: "EFS /rfc/device_lut/*" },
	10: { name: "RFC_MMW", confidence: "high", note: "MAVZ MCFG HW image, /rfc/29xx (mmWave RF card)" },
	13: { name: "PROT_SKU?", confidence: "low", note: "MAVZ 64 KiB binary table" },
	15: { name: "PROT_NV", confidence: "high", note: "protocol static NV/EFS" },
	17: {
		name: "PROT_PRI",
		confidence: "high",
		note: "product PRI defaults: /policyman/*.xml, /data/3gpp/*.xml",
	},
	20: { name: "SHPNG", confidence: "high", note: "common shipping settings" },
	22: { name: "PA_CHAR?", confidence: "low", note: "pt.mbn RFNV 646xx power tables" },
	24: { name: "PA_CHAR?", confidence: "low", note: "pt.mbn RFNV 646xx incl. A-MPR NS XML (NV 64628)" },
};

export const fileTypeName = (t: number): string => BBCFG_FILE_TYPES[t]?.name ?? `type ${t}`;

interface BbcfgIndexRecord {
	platform: number;
	sku: number;
	hwRev: number;
	fileType: number;
	fileTypeName: string;
	/** Position in `blobs`. */
	blob: number;
}

type BlobFormat = "der" | "mavz" | "bin";

export interface BbcfgBlobRef {
	index: number;
	/** Stored as 40 ASCII hex chars; not a hash of the payload (the modem copies it, as bytes, into /mav/bbcfg_file_hash_*). */
	digest: string;
	offset: number;
	length: number;
	format: BlobFormat;
}

export interface BbcfgContainer {
	/** "CFG" (bbcfg.mbn) or "POW" (pt.mbn): the first four bytes reversed. */
	magic: string;
	headerVersion: number;
	/** Both header size fields; each is the file length - 0x28. */
	sizes: [number, number];
	meta: BbcfgMeta;
	index: BbcfgIndexRecord[];
	blobs: BbcfgBlobRef[];
}

export const isBbcfg = (b: Uint8Array): boolean => b.length > 0x32 && asciiAt(b, 0x28, "BBCFGMBN");

/** Header, metadata, index and blob table; payloads are left in place. */ // bbcfg.mbn / pt.mbn
export function readBbcfg(b: Uint8Array): BbcfgContainer {
	if (!isBbcfg(b)) throw new Error("not a BBCFGMBN container");
	const root = readTlv(b, 0x30);
	const meta: BbcfgMeta = {};
	const index: BbcfgIndexRecord[] = [];
	const blobs: BbcfgBlobRef[] = [];
	for (const t of kids(b, root)) {
		if (ctx(t, 8)) {
			// a8: {9f8148 platform, 9f8149 sku, 9f814a hw_rev, 9f814b file_type, 9f814c blob}
			for (const rec of kids(b, t)) {
				const f: number[] = [];
				for (const x of kids(b, rec))
					if (x.cls === 2 && x.num >= 200 && x.num <= 204) f[x.num - 200] = uint(val(b, x));
				const [platform, sku, hwRev, fileType, blob] = f;
				if (
					platform === undefined ||
					sku === undefined ||
					hwRev === undefined ||
					fileType === undefined ||
					blob === undefined
				) {
					throw new Error(`bbcfg index record at ${rec.start} lacks a field`);
				}
				index.push({ platform, sku, hwRev, fileType, fileTypeName: fileTypeName(fileType), blob });
			}
		} else if (ctx(t, 9)) {
			// a9: {9f64 digest, 9f65 payload}
			for (const rec of kids(b, t)) {
				let digest = "",
					p: Tlv | undefined;
				for (const x of kids(b, rec)) {
					if (ctx(x, 100)) digest = latin1(val(b, x));
					else if (ctx(x, 101)) p = x;
				}
				if (!p) continue;
				const head = b.subarray(p.contentStart, p.contentStart + 4);
				const format: BlobFormat = asciiAt(head, 0, "MAVZ") ? "mavz" : head[0] === 0x30 ? "der" : "bin";
				blobs.push({
					index: blobs.length,
					digest,
					offset: p.contentStart,
					length: p.contentEnd - p.contentStart,
					format,
				});
			}
		} else if (t.cls === 2 && !t.constructed) {
			const key = META_KEYS[t.num];
			if (key !== undefined) meta[key] = latin1(val(b, t));
		}
	}
	const h = meta.versionHex;
	if (h && /^[0-9a-f]{6}/i.test(h)) {
		meta.version = `${parseInt(h.slice(0, 2), 16)}.${String(parseInt(h.slice(2, 4), 16)).padStart(2, "0")}.${String(parseInt(h.slice(4, 6), 16)).padStart(2, "0")}`;
	}
	return {
		magic: latin1(b.subarray(0, 4)).split("").toReversed().join("").replace(/\0/g, ""),
		headerVersion: u32le(b, 4),
		sizes: [u32le(b, 0x10), u32le(b, 0x14)],
		meta,
		index,
		blobs,
	};
}

/** A declared MAVZ length past this is refused, so a corrupt header cannot allocate gigabytes. */
const MAVZ_CAP = 256 << 20;

/** "MAVZ" + u32le inflated length + zlib stream. */ // bbcfg.mbn
export function inflateMavz(p: Uint8Array): Uint8Array {
	if (!asciiAt(p, 0, "MAVZ")) throw new Error("not MAVZ");
	return inflateExact(p.subarray(8), u32le(p, 4), MAVZ_CAP, "MAVZ");
}

export interface NvRecord {
	id: number;
	value: Uint8Array;
	/** 9f8311 and 9f8314, meaning unknown. */
	f11?: number;
	f14?: number;
}

export interface EfsRecord {
	path: string;
	data: Uint8Array;
	/** 9f8377 and 9f8378, meaning unknown. */
	f77?: number;
	f78?: number;
}

export interface BbcfgBlob extends BbcfgBlobRef {
	nv: NvRecord[];
	files: EfsRecord[];
	/** MAVZ payload, inflated. */
	image?: Uint8Array;
	mcfg?: McfgImage;
}

/** Small integer fields; wider ones are not integers. */
const small = (b: Uint8Array): number | undefined => (b.length <= 6 ? uint(b) : undefined);

/** DER blob payload: SEQUENCE { bf8458 NV records, bf8459 EFS records }. */ // bbcfg.mbn: blob tag 9f65
export function readBlobRecords(p: Uint8Array): { nv: NvRecord[]; files: EfsRecord[] } {
	const nv: NvRecord[] = [],
		files: EfsRecord[] = [];
	const root = readTlv(p, 0);
	for (const group of kids(p, root)) {
		if (ctx(group, 600)) {
			// bf8458: {9f8310 id, 9f8311, 9f8312 size, 9f8313 value, 9f8314}
			for (const rec of kids(p, group)) {
				const r: NvRecord = { id: 0, value: new Uint8Array(0) };
				for (const x of kids(p, rec)) {
					const v = val(p, x);
					if (ctx(x, 400)) r.id = uint(v);
					else if (ctx(x, 403)) r.value = v;
					else if (ctx(x, 401)) {
						const n = small(v);
						if (n !== undefined) r.f11 = n;
					} else if (ctx(x, 404)) {
						const n = small(v);
						if (n !== undefined) r.f14 = n;
					}
				}
				nv.push(r);
			}
		} else if (ctx(group, 601)) {
			// bf8459: {9f8374 path, 9f8375 size, 9f8376 data, 9f8377, 9f8378}
			for (const rec of kids(p, group)) {
				const r: EfsRecord = { path: "", data: new Uint8Array(0) };
				for (const x of kids(p, rec)) {
					const v = val(p, x);
					if (ctx(x, 500)) r.path = trimNul(latin1(v));
					else if (ctx(x, 502)) r.data = v;
					else if (ctx(x, 503)) {
						const n = small(v);
						if (n !== undefined) r.f77 = n;
					} else if (ctx(x, 504)) {
						const n = small(v);
						if (n !== undefined) r.f78 = n;
					}
				}
				files.push(r);
			}
		}
	}
	return { nv, files };
}

/** One blob's content; MAVZ images are inflated and parsed as MCFG when they are one. */
export function decodeBbcfgBlob(b: Uint8Array, ref: BbcfgBlobRef): BbcfgBlob {
	const p = b.subarray(ref.offset, ref.offset + ref.length);
	if (ref.format === "mavz") {
		const image = inflateMavz(p);
		const mcfg = parseMcfg(image);
		return { ...ref, nv: [], files: [], image, ...(mcfg ? { mcfg } : {}) };
	}
	if (ref.format === "der") return { ...ref, ...readBlobRecords(p) };
	return { ...ref, nv: [], files: [] };
}
