/**
 * IPCC container reader. An .ipcc is a plain (unencrypted) ZIP holding
 * `Payload/<Name>.bundle/...`.
 */

import { unzipSync } from "fflate";
import {
	asciiAt,
	base64ToBytes,
	bytesToHex,
	compareUtf8,
	concatBytes,
	errorMessage,
	maybeText,
	sha256Hex,
} from "@carrier-explode/binary";
import { parsePlist, toJsonSafe } from "./plist.ts";
import { decodePri, type PriDecoded, type PriFormat } from "./pri.ts";
import { decodeTri, type TriDecoded } from "./tri.ts";
import { pngDimensions, isCgBI } from "./png.ts";
import { decodePrl, type PrlDecoded } from "@carrier-explode/decode-qualcomm";
import { isCmsSignedData, parseSignedData, type CmsSignedData } from "./cms.ts";
import { parseCertificate, pemBlocks, type CertInfo } from "./der.ts";
import { decodeDmu, type DmuKey } from "./dmu.ts";
import { decodeCaf, isCaf, type CafInfo } from "./caf.ts";

const td = new TextDecoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

const isControlByte = (c: number): boolean => c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d;

/** Whole-file UTF-8 text with no control bytes beyond tab and line breaks, else undefined. */
function wholeText(b: Uint8Array): string | undefined {
	if (!isMostlyText(b)) return undefined;
	try {
		const t = strictUtf8.decode(b);
		return b.some(isControlByte) ? undefined : t;
	} catch {
		return undefined;
	}
}

/** True when the bytes are overwhelmingly printable, allowing UTF-8 sequences. */
function isMostlyText(b: Uint8Array): boolean {
	if (b.length === 0) return false;
	let suspect = 0;
	const n = Math.min(b.length, 4096);
	for (const c of b.subarray(0, n)) {
		if (c === 0 || (c < 0x20 && c !== 9 && c !== 10 && c !== 13)) suspect++;
	}
	return suspect / n < 0.02;
}

export type FileKind =
	| "plist"
	| "pri-der"
	| "pri-plain"
	| "tri-der"
	| "strings"
	| "mobileconfig"
	| "xml"
	| "certificate"
	| "image"
	| "metadata"
	| "prl"
	| "dmu"
	| "audio"
	| "binary";

interface MemberType {
	readonly kind: FileKind;
	/** Media type for serving the member as-is. */
	readonly contentType: string;
}

const OCTETS = "application/octet-stream",
	XML = "application/xml",
	PLIST = "application/x-plist",
	CERT = "application/x-x509-ca-cert";

/** By lower-case extension; the longest one a name ends with wins, so `.der.pri` beats `.pri`. */
const MEMBER_TYPES = {
	".der.pri": { kind: "pri-der", contentType: OCTETS },
	".der.gri": { kind: "pri-der", contentType: OCTETS },
	".der.tri": { kind: "tri-der", contentType: OCTETS },
	".pri": { kind: "pri-plain", contentType: OCTETS },
	".gri": { kind: "pri-plain", contentType: OCTETS },
	".strings": { kind: "strings", contentType: PLIST },
	".mobileconfig": { kind: "mobileconfig", contentType: XML },
	".plist": { kind: "plist", contentType: PLIST },
	".loctable": { kind: "plist", contentType: PLIST },
	".prl": { kind: "prl", contentType: OCTETS },
	".dmu": { kind: "dmu", contentType: OCTETS },
	".caf": { kind: "audio", contentType: "audio/x-caf" },
	".xml": { kind: "xml", contentType: XML },
	".ims": { kind: "xml", contentType: XML },
	".crt": { kind: "certificate", contentType: CERT },
	".cer": { kind: "certificate", contentType: CERT },
	".pem": { kind: "certificate", contentType: CERT },
	".png": { kind: "image", contentType: "image/png" },
	".jpg": { kind: "image", contentType: "image/jpeg" },
	".jpeg": { kind: "image", contentType: "image/jpeg" },
	".gif": { kind: "image", contentType: "image/gif" },
	".tif": { kind: "image", contentType: "image/tiff" },
	".tiff": { kind: "image", contentType: "image/tiff" },
	".svg": { kind: "image", contentType: "image/svg+xml" },
	".metadata": { kind: "metadata", contentType: OCTETS },
	".txt": { kind: "binary", contentType: "text/plain; charset=utf-8" },
} satisfies Record<string, MemberType>;

const OTHER: MemberType = { kind: "binary", contentType: OCTETS };

const isMemberExtension = (ext: string): ext is keyof typeof MEMBER_TYPES => Object.hasOwn(MEMBER_TYPES, ext);

function memberType(path: string): MemberType {
	const base = (path.split("/").pop() ?? path).toLowerCase();
	for (let i = base.indexOf("."); i >= 0; i = base.indexOf(".", i + 1)) {
		const ext = base.slice(i);
		if (isMemberExtension(ext)) return MEMBER_TYPES[ext];
	}
	return OTHER;
}

/** Media type for serving a member as-is. */
export const contentTypeOf = (path: string): string => memberType(path).contentType;

/** Short explanation of what a member is, shown next to the file list. */
const KIND_NOTES: Record<string, string> = {
	".prl": "CDMA Preferred Roaming List, a binary system-selection table",
	".dmu": "Dynamic Mobile IP Key Update (DMU) RSA public key",
	".mcfopota": "OP-OTA modem configuration blob",
	".metadata": "base64-encoded JSON left behind by Apple's bundle packager",
	".ims": "Qualcomm IMS stack configuration (QIMF XML)",
	".xml": "OMA-DM management tree",
};

/** An extension's KIND_NOTES entry; null without one. */
const noteFor = (ext: string): string | null => KIND_NOTES[ext] ?? null;

export interface BundleFile {
	/** Path relative to the .bundle root. */
	path: string;
	size: number;
	kind: FileKind;
	/** lproj locale when the file lives in a localisation folder. */
	locale?: string;
	/** The boards an overrides_* file is for, as its name lists them; which phone each is, is the device records' to say. */
	boards?: string[];
}

export interface BundleInfo {
	bundleName: string;
	files: BundleFile[];
	/** Total uncompressed bytes. */
	totalSize: number;
	locales: string[];
	deviceStems: string[];
}

/** CMS SignedData envelope of a signed profile, without its content. */
export type CmsSignature = Omit<CmsSignedData, "content">;

/** Why a member did not decode as its name says: the decoder threw, or the bytes are not that format. */
type DecodeError = { reason: "failed"; message: string } | { reason: "unrecognised"; message?: string };

/** The member as text, or a hex preview of its bytes. */
type RawBody = { readonly text: string } | { readonly hex: string };

/** What a member decoded to; `raw` when nothing structured did. */
type FileView =
	| { readonly type: "tree"; readonly plist: unknown; readonly signature: CmsSignature | null }
	| { readonly type: "pri"; readonly pri: PriDecoded }
	| { readonly type: "tri"; readonly tri: TriDecoded }
	| { readonly type: "prl"; readonly prl: PrlDecoded }
	| { readonly type: "dmu"; readonly dmu: DmuKey }
	| { readonly type: "audio"; readonly audio: CafInfo }
	| { readonly type: "certificates"; readonly certificates: readonly CertInfo[] }
	| { readonly type: "image"; readonly width: number; readonly height: number; readonly cgbi: boolean }
	| { readonly type: "raw" };

/** Kinds decoded as a value tree: plists, strings, profiles, plain PRIs and packager metadata. */
export type PlistKind = "plist" | "strings" | "mobileconfig" | "pri-plain" | "metadata";

export interface DecodedFile {
	readonly path: string;
	readonly size: number;
	readonly boards?: string[];
	/** The kind its name says, or the one its bytes are (a DER PRI under a plain name). */
	readonly kind: FileKind;
	readonly view: FileView;
	/** Its text or bytes, beside the view or in place of it; null where the view is all there is. */
	readonly raw: RawBody | null;
	/** What the member is, when the structure does not say. */
	readonly note: string | null;
	readonly error: DecodeError | null;
}

type Base = Pick<DecodedFile, "path" | "size" | "boards" | "raw" | "note" | "error">;

const PLIST_KINDS: ReadonlySet<FileKind> = new Set<PlistKind>([
	"plist",
	"strings",
	"mobileconfig",
	"pri-plain",
	"metadata",
]);
export const isPlistKind = (k: FileKind): k is PlistKind => PLIST_KINDS.has(k);

/** The value tree of a decoded member, when it has one. */
export const decodedPlist = (d: DecodedFile): unknown => (d.view.type === "tree" ? d.view.plist : undefined);

/** The decoded PRI of a `.der.pri` / `.der.gri` / Apple-modem `.der.tri` member (or a DER one under a plain name). */
export const decodedPri = (d: DecodedFile): PriDecoded | undefined =>
	d.view.type === "pri" ? d.view.pri : undefined;

/** Hex shown for a member with no better view; at most 8 KiB of it. */
const HEX_PREVIEW = 8192;
const failed = (e: unknown): DecodeError => ({ reason: "failed", message: errorMessage(e) });

const classify = (path: string): FileKind => memberType(path).kind;

function localeOf(path: string): string | undefined {
	const m = /(?:^|\/)([A-Za-z0-9_-]+)\.lproj\//.exec(path);
	return m ? m[1] : undefined;
}

/** The boards an `overrides_<boards>.*` file is for (`D83_D84`); undefined for any other file. */
export function deviceStem(path: string): string | undefined {
	const base = path.split("/").pop() ?? "";
	const m = /^overrides_(.+?)\.(der\.pri|der\.gri|der\.tri|plist|pri)$/.exec(base);
	return m ? m[1] : undefined;
}

/** An MVNO set's override file names the set before its boards: `overrides_mvno1_D23.der.pri`. */
const MVNO_SET = /^mvno(\d+)$/;

/** The boards an override file is for, in the order its name lists them; undefined for any other file. */
export const overrideBoards = (path: string): string[] | undefined =>
	deviceStem(path)
		?.split("_")
		.filter((part) => part !== "" && !MVNO_SET.test(part));

/** The MVNO set an override file is for (1 for `overrides_mvno1_D23.der.pri`); null for the carrier's own or any other file. */
export function overrideMvnoSet(path: string): number | null {
	const set = MVNO_SET.exec(deviceStem(path)?.split("_")[0] ?? "")?.[1];
	return set === undefined ? null : Number(set);
}

export interface OpenedBundle {
	readonly info: BundleInfo;
	/** A file's bytes by its path in `info.files`, inflated on each read. MemberError for any other path. */
	readonly read: (path: string) => Uint8Array;
}

/** Lists the bundle from the zip's central directory: fflate's filter sees each name and size before inflating. */
export function openIpcc(bytes: Uint8Array): OpenedBundle {
	const sizeOf = new Map<string, number>();
	unzipSync(bytes, {
		filter: ({ name, originalSize }) => {
			if (!name.endsWith("/")) sizeOf.set(name, originalSize);
			return false;
		},
	});
	const prefix =
		[...sizeOf.keys()].map((n) => /^(.*?\.bundle\/)/.exec(n)?.[1]).find((p) => p !== undefined) ?? "";
	const bundleName = (prefix.split("/").findLast(Boolean) ?? "bundle").replace(/\.bundle$/, "");

	const members = new Map<string, number>();
	for (const [n, size] of sizeOf) {
		const rel = n.slice(prefix.length);
		if (!n.startsWith(prefix) || !rel || rel.startsWith("__MACOSX") || rel.endsWith(".DS_Store")) continue;
		members.set(rel, size);
	}

	const files: BundleFile[] = [];
	const locales = new Set<string>();
	const stems = new Set<string>();
	let totalSize = 0;
	for (const [rel, size] of members) {
		totalSize += size;
		const loc = localeOf(rel);
		if (loc) locales.add(loc);
		const stem = deviceStem(rel);
		if (stem) stems.add(stem);
		const boards = overrideBoards(rel);
		files.push({
			path: rel,
			size,
			kind: classify(rel),
			...(loc ? { locale: loc } : {}),
			...(boards ? { boards } : {}),
		});
	}
	files.sort((a, b) => a.path.localeCompare(b.path));
	return {
		info: {
			bundleName,
			files,
			totalSize,
			locales: [...locales].toSorted(),
			deviceStems: [...stems].toSorted(),
		},
		read: (path) => {
			if (!members.has(path)) throw new MemberError(`no such file in bundle: ${path || "(empty path)"}`);
			const name = prefix + path;
			const member = unzipSync(bytes, { filter: (f) => f.name === name })[name];
			if (member === undefined) throw new Error(`${path}: listed but not inflated`);
			return member;
		},
	};
}

/** A path that names no file of the bundle. */
export class MemberError extends Error {
	override name = "MemberError";
}

export function decodeFile(b: OpenedBundle, relPath: string): DecodedFile {
	const bytes = b.read(relPath);
	const boards = overrideBoards(relPath);
	const base: Base = {
		path: relPath,
		size: bytes.length,
		...(boards ? { boards } : {}),
		raw: null,
		note: null,
		error: null,
	};
	const kind = classify(relPath);
	try {
		return decodeBytes(base, kind, bytes);
	} catch (e) {
		return {
			...base,
			kind: isPlistKind(kind) ? kind : "binary",
			view: RAW,
			raw: { hex: bytesToHex(bytes.subarray(0, HEX_PREVIEW)) },
			error: failed(e),
		};
	}
}

const RAW: FileView = { type: "raw" };

function decodeBytes(base: Base, kind: FileKind, bytes: Uint8Array): DecodedFile {
	const preview = (): RawBody => ({ hex: bytesToHex(bytes.subarray(0, HEX_PREVIEW)) });
	const priKind: PriFormat = base.path.endsWith(".gri")
		? "der.gri"
		: base.path.endsWith(".tri")
			? "der.tri"
			: "der.pri";
	const pri = (): DecodedFile => ({
		...base,
		kind: "pri-der",
		view: { type: "pri", pri: decodePri(bytes, priKind) },
	});
	if (kind === "pri-der") return pri();
	// The Apple-modem form is a DER PRI (a SET); the Qualcomm-phone form is a [0] wrapper.
	if (kind === "tri-der")
		return bytes[0] === 0x31 ? pri() : { ...base, kind, view: { type: "tri", tri: decodeTri(bytes) } };
	if (isPlistKind(kind)) {
		const tree = (plist: unknown, signature: CmsSignature | null = null): DecodedFile => ({
			...base,
			kind,
			view: { type: "tree", plist, signature },
		});
		if (kind === "metadata") {
			// Base64-encoded UTF-8 JSON written by Apple's packaging tool.
			try {
				return tree(JSON.parse(td.decode(base64ToBytes(td.decode(bytes).replace(/\s+/g, "")))));
			} catch {
				return {
					...base,
					kind,
					view: RAW,
					raw: { text: td.decode(bytes) },
					error: { reason: "unrecognised", message: "expected base64-encoded JSON" },
				};
			}
		}
		// Some `.pri` files are plists, a few are raw XML; legacy `.strings` are plain text; signed profiles are CMS-wrapped plists.
		if (isCmsSignedData(bytes)) {
			const { content, ...signature } = parseSignedData(bytes);
			return tree(toJsonSafe(parsePlist(content)), signature);
		}
		if (asciiAt(bytes, 0, "bplist") || /^\s*<(\?xml|!DOCTYPE|plist)/.test(td.decode(bytes.subarray(0, 8))))
			return tree(toJsonSafe(parsePlist(bytes)));
		// A few OTA `overrides_*.pri` are the DER form under the plain name.
		if (kind === "pri-plain" && bytes[0] === 0x31) return pri();
		const text = maybeText(bytes) ?? wholeText(bytes);
		if (text === undefined)
			return { ...base, kind, view: RAW, raw: preview(), error: { reason: "unrecognised" } };
		// Legacy `.strings` are plain text; a `.plist` or profile that is not one says so.
		return {
			...base,
			kind,
			view: RAW,
			raw: { text },
			...(kind === "plist" || kind === "mobileconfig"
				? { error: { reason: "unrecognised", message: "not a plist" } }
				: {}),
		};
	}
	switch (kind) {
		case "xml":
			return { ...base, kind, view: RAW, raw: { text: td.decode(bytes) } };
		case "certificate": {
			if (bytes[0] === 0x30) {
				const raw = { hex: bytesToHex(bytes) };
				try {
					return {
						...base,
						kind,
						view: { type: "certificates", certificates: [parseCertificate(bytes)] },
						raw,
					};
				} catch (e) {
					return { ...base, kind, view: RAW, raw, error: failed(e) };
				}
			}
			const text = td.decode(bytes);
			const certificates: CertInfo[] = [];
			const errors: string[] = [];
			for (const [i, der] of pemBlocks(text).entries()) {
				try {
					certificates.push(parseCertificate(der));
				} catch (e) {
					errors.push(`certificate ${i + 1}: ${errorMessage(e)}`);
				}
			}
			// Some CarrierCA.crt files are `openssl x509 -subject -issuer` output wrapping the PEM.
			return {
				...base,
				kind,
				view: certificates.length ? { type: "certificates", certificates } : RAW,
				raw: { text },
				note: text.startsWith("-----BEGIN") ? null : "PEM with OpenSSL subject/issuer lines",
				error: errors.length ? { reason: "failed", message: errors.join("; ") } : null,
			};
		}
		case "prl":
			try {
				return { ...base, kind, view: { type: "prl", prl: decodePrl(bytes) }, raw: preview() };
			} catch (e) {
				return { ...base, kind, view: RAW, raw: preview(), note: noteFor(".prl"), error: failed(e) };
			}
		case "dmu":
			try {
				return { ...base, kind, view: { type: "dmu", dmu: decodeDmu(bytes) }, raw: preview() };
			} catch (e) {
				return { ...base, kind, view: RAW, raw: preview(), note: noteFor(".dmu"), error: failed(e) };
			}
		case "audio":
			return isCaf(bytes)
				? { ...base, kind, view: { type: "audio", audio: decodeCaf(bytes) } }
				: { ...base, kind, view: RAW, error: { reason: "unrecognised" } };
		case "image": {
			// The raw bytes are served by /api/raw; only the shape is useful here.
			const dim = pngDimensions(bytes);
			return { ...base, kind, view: dim ? { type: "image", ...dim, cgbi: isCgBI(bytes) } : RAW };
		}
		default: {
			const ext = "." + (base.path.split("/").pop() ?? "").split(".").slice(1).join(".");
			const text = maybeText(bytes) ?? wholeText(bytes);
			return {
				...base,
				kind: "binary",
				view: RAW,
				raw: text ? { text } : preview(),
				note: noteFor(ext) ?? noteFor("." + ext.split(".").pop()),
			};
		}
	}
}

/**
 * A bundle's identity: sha256 over "path NUL sha256(bytes) LF" for every file, in byte order of path.
 * Stored .ipcc records carry it as `cid`, so it is also the integrity check.
 */
export async function contentId(b: OpenedBundle): Promise<string> {
	const enc = new TextEncoder();
	const paths = b.info.files.map((f) => f.path).toSorted(compareUtf8);
	const lines = await Promise.all(
		paths.map(async (path) =>
			concatBytes([enc.encode(path), enc.encode("\0" + (await sha256Hex(b.read(path))) + "\n")]),
		),
	);
	return sha256Hex(concatBytes(lines));
}
