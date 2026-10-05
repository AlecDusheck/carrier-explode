/**
 * IPCC container reader. An .ipcc is a plain (unencrypted) ZIP holding
 * `Payload/<Name>.bundle/...`.
 */

import { unzipSync } from "fflate";
import { asciiAt, base64ToBytes, bytesToHex, concatBytes, errorMessage, maybeText, sha256Hex } from "@carrier-explode/binary";
import { comparePaths } from "./ipcc.ts";
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

/** Whole-file UTF-8 text with no control bytes beyond tab and line breaks, else undefined. */
function wholeText(b: Uint8Array): string | undefined {
  if (!isMostlyText(b)) return undefined;
  try {
    const t = strictUtf8.decode(b);
    return /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t) ? undefined : t;
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

const OCTETS = "application/octet-stream", XML = "application/xml", PLIST = "application/x-plist", CERT = "application/x-x509-ca-cert";

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

/** `{ note }` for an extension's KIND_NOTES entry, to spread; nothing without one. */
const noteFor = (ext: string): { note?: string } => {
  const note = KIND_NOTES[ext];
  return note === undefined ? {} : { note };
};

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
export type DecodeError = { reason: "failed"; message: string } | { reason: "unrecognised"; message?: string };

interface DecodedCommon {
  path: string;
  size: number;
  boards?: string[];
  /** What the member is, when the structure does not say. */
  note?: string;
  error?: DecodeError;
  /** Whole-file text, where the content is text. */
  text?: string;
  /** Hex of the bytes (the first 8 KiB for big members), where there is no text. */
  hex?: string;
}

/** Kinds decoded as a value tree: plists, strings, profiles, plain PRIs and packager metadata. */
export type PlistKind = "plist" | "strings" | "mobileconfig" | "pri-plain" | "metadata";

export type DecodedFile = DecodedCommon & (
  | { kind: PlistKind; plist?: unknown; signature?: CmsSignature }
  | { kind: "pri-der"; pri: PriDecoded }
  | { kind: "tri-der"; tri: TriDecoded }
  | { kind: "prl"; prl?: PrlDecoded }
  | { kind: "dmu"; dmu?: DmuKey }
  | { kind: "audio"; audio?: CafInfo }
  | { kind: "certificate"; certificates: CertInfo[] }
  | { kind: "image"; image?: { width: number; height: number; cgbi: boolean } }
  | { kind: "xml" | "binary" }
);

const PLIST_KINDS: ReadonlySet<FileKind> = new Set<PlistKind>(["plist", "strings", "mobileconfig", "pri-plain", "metadata"]);
export const isPlistKind = (k: FileKind): k is PlistKind => PLIST_KINDS.has(k);

/** The value tree of a decoded member, when it has one. */
export const decodedPlist = (d: DecodedFile): unknown => ("plist" in d ? d.plist : undefined);

/** The decoded PRI of a `.der.pri` / `.der.gri` / Apple-modem `.der.tri` member (or a DER one under a plain name). */
export const decodedPri = (d: DecodedFile): PriDecoded | undefined => (d.kind === "pri-der" ? d.pri : undefined);

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

/** The boards an override file is for, in the order its name lists them; undefined for any other file. */
export const overrideBoards = (path: string): string[] | undefined => deviceStem(path)?.split("_").filter(Boolean);

export interface OpenedBundle {
  info: BundleInfo;
  entries: Record<string, Uint8Array>;
  /** Key into `entries` for a given bundle-relative path. */
  prefix: string;
}

export function openIpcc(bytes: Uint8Array): OpenedBundle {
  const zip = unzipSync(bytes);
  const names = Object.keys(zip).filter((n) => !n.endsWith("/"));
  let prefix = "";
  for (const n of names) {
    const m = /^(.*?\.bundle\/)/.exec(n);
    if (m) { prefix = m[1] ?? ""; break; }
  }
  const bundleName = (prefix.split("/").filter(Boolean).pop() ?? "bundle").replace(/\.bundle$/, "");

  const files: BundleFile[] = [];
  const locales = new Set<string>();
  const stems = new Set<string>();
  let totalSize = 0;

  for (const n of names) {
    if (prefix && !n.startsWith(prefix)) continue;
    const rel = prefix ? n.slice(prefix.length) : n;
    if (!rel || rel.startsWith("__MACOSX") || rel.endsWith(".DS_Store")) continue;
    const data = zip[n];
    if (data === undefined) continue;
    const size = data.length;
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
      locales: [...locales].sort(),
      deviceStems: [...stems].sort(),
    },
    entries: zip,
    prefix,
  };
}

export function decodeFile(b: OpenedBundle, relPath: string): DecodedFile {
  if (!relPath || relPath.endsWith("/")) throw new Error(`not a file: ${relPath || "(empty path)"}`);
  const bytes = b.entries[b.prefix + relPath] ?? b.entries[relPath];
  if (!bytes) throw new Error(`no such file in bundle: ${relPath}`);
  const boards = overrideBoards(relPath);
  const base: DecodedCommon = { path: relPath, size: bytes.length, ...(boards ? { boards } : {}) };
  const kind = classify(relPath);
  try {
    return decodeBytes(base, kind, bytes);
  } catch (e) {
    const fallback = { ...base, error: failed(e), hex: bytesToHex(bytes.subarray(0, HEX_PREVIEW)) };
    return isPlistKind(kind) ? { ...fallback, kind } : { ...fallback, kind: "binary" };
  }
}

function decodeBytes(base: DecodedCommon, kind: FileKind, bytes: Uint8Array): DecodedFile {
  const preview = () => bytesToHex(bytes.subarray(0, HEX_PREVIEW));
  const priKind: PriFormat = base.path.endsWith(".gri") ? "der.gri" : base.path.endsWith(".tri") ? "der.tri" : "der.pri";
  if (kind === "pri-der") return { ...base, kind, pri: decodePri(bytes, priKind) };
  // The Apple-modem form is a DER PRI (a SET); the Qualcomm-phone form is a [0] wrapper.
  if (kind === "tri-der") return bytes[0] === 0x31 ? { ...base, kind: "pri-der", pri: decodePri(bytes, priKind) } : { ...base, kind, tri: decodeTri(bytes) };
  if (isPlistKind(kind)) {
    if (kind === "metadata") {
      // Base64-encoded UTF-8 JSON written by Apple's packaging tool.
      try {
        const json: unknown = JSON.parse(td.decode(base64ToBytes(td.decode(bytes).replace(/\s+/g, ""))));
        return { ...base, kind, plist: json };
      } catch {
        return { ...base, kind, text: td.decode(bytes), error: { reason: "unrecognised", message: "expected base64-encoded JSON" } };
      }
    }
    // Some `.pri` files are plists, a few are raw XML; legacy `.strings` are plain text; signed profiles are CMS-wrapped plists.
    if (isCmsSignedData(bytes)) {
      const { content, ...signature } = parseSignedData(bytes);
      return { ...base, kind, signature, plist: toJsonSafe(parsePlist(content)) };
    }
    if (asciiAt(bytes, 0, "bplist") || /^\s*<(\?xml|!DOCTYPE|plist)/.test(td.decode(bytes.subarray(0, 8)))) {
      return { ...base, kind, plist: toJsonSafe(parsePlist(bytes)) };
    }
    // A few OTA `overrides_*.pri` are the DER form under the plain name.
    if (kind === "pri-plain" && bytes[0] === 0x31) return { ...base, kind: "pri-der", pri: decodePri(bytes, priKind) };
    const text = maybeText(bytes) ?? (isMostlyText(bytes) ? td.decode(bytes) : undefined);
    return text !== undefined ? { ...base, kind, text } : { ...base, kind, hex: preview(), error: { reason: "unrecognised" } };
  }
  switch (kind) {
    case "xml":
      return { ...base, kind, text: td.decode(bytes) };
    case "certificate": {
      if (bytes[0] === 0x30) {
        const hex = bytesToHex(bytes);
        try {
          return { ...base, kind, hex, certificates: [parseCertificate(bytes)] };
        } catch (e) {
          return { ...base, kind, hex, certificates: [], error: failed(e) };
        }
      }
      const text = td.decode(bytes);
      const certificates: CertInfo[] = [];
      const errors: string[] = [];
      for (const [i, der] of pemBlocks(text).entries()) {
        try { certificates.push(parseCertificate(der)); } catch (e) { errors.push(`certificate ${i + 1}: ${errorMessage(e)}`); }
      }
      // Some CarrierCA.crt files are `openssl x509 -subject -issuer` output wrapping the PEM.
      return {
        ...base, kind, text, certificates,
        ...(text.startsWith("-----BEGIN") ? {} : { note: "PEM with OpenSSL subject/issuer lines" }),
        ...(errors.length ? { error: { reason: "failed", message: errors.join("; ") } } : {}),
      };
    }
    case "prl":
      try {
        return { ...base, kind, hex: preview(), prl: decodePrl(bytes) };
      } catch (e) {
        return { ...base, kind, hex: preview(), ...noteFor(".prl"), error: failed(e) };
      }
    case "dmu":
      try {
        return { ...base, kind, hex: preview(), dmu: decodeDmu(bytes) };
      } catch (e) {
        return { ...base, kind, hex: preview(), ...noteFor(".dmu"), error: failed(e) };
      }
    case "audio":
      return isCaf(bytes) ? { ...base, kind, audio: decodeCaf(bytes) } : { ...base, kind, error: { reason: "unrecognised" } };
    case "image": {
      // The raw bytes are served by /api/raw; only the shape is useful here.
      const dim = pngDimensions(bytes);
      return { ...base, kind, ...(dim ? { image: { ...dim, cgbi: isCgBI(bytes) } } : {}) };
    }
    default: {
      const ext = "." + (base.path.split("/").pop() ?? "").split(".").slice(1).join(".");
      const known = KIND_NOTES[ext] ?? KIND_NOTES["." + ext.split(".").pop()];
      const text = maybeText(bytes) ?? wholeText(bytes);
      return { ...base, kind: "binary", ...(known ? { note: known } : {}), ...(text ? { text } : { hex: preview() }) };
    }
  }
}

/**
 * A bundle's identity: sha256 over "path NUL sha256(bytes) LF" for every file, in
 * byte order of path. Stored .ipcc records carry it as `cid`, so this doubles as
 * the integrity check.
 */
export async function contentId(b: OpenedBundle): Promise<string> {
  const enc = new TextEncoder();
  const paths = b.info.files.map((f) => f.path).sort(comparePaths);
  const lines = await Promise.all(paths.map(async (path) => {
    const bytes = b.entries[b.prefix + path];
    if (bytes === undefined) throw new Error(`${path}: listed but not in the archive`);
    return concatBytes([enc.encode(path), enc.encode("\0" + (await sha256Hex(bytes)) + "\n")]);
  }));
  return sha256Hex(concatBytes(lines));
}
