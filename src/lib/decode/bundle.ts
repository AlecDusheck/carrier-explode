/**
 * IPCC container reader. An .ipcc is a plain (unencrypted) ZIP holding
 * `Payload/<Name>.bundle/...`.
 */

import { unzipSync } from "fflate";
import { asciiAt, bytesToHex, latin1, maybeText } from "./bytes";
import { parsePlist, toJsonSafe } from "./plist";
import { decodePri, type PriDecoded } from "./pri";
import { describeDevices } from "./devices";
import { pngDimensions, isCgBI } from "./png";
import { decodePrl, type PrlDecoded } from "./prl";
import { isCmsSignedData, parseSignedData, type CmsSignedData } from "./cms";
import { parseCertificate, pemBlocks, type CertInfo } from "./der";
import { decodeDmu, type DmuKey } from "./dmu";
import { decodeCaf, isCaf, type CafInfo } from "./caf";

const td = new TextDecoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

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
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0 || (c < 0x20 && c !== 9 && c !== 10 && c !== 13)) suspect++;
  }
  return suspect / n < 0.02;
}

export type FileKind =
  | "plist"
  | "pri-der"
  | "pri-plain"
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

/** Media type for serving a member as-is. */
export function contentTypeOf(path: string): string {
  const b = (path.split("/").pop() ?? path).toLowerCase();
  if (b.endsWith(".png")) return "image/png";
  if (b.endsWith(".jpg") || b.endsWith(".jpeg")) return "image/jpeg";
  if (b.endsWith(".gif")) return "image/gif";
  if (b.endsWith(".tiff") || b.endsWith(".tif")) return "image/tiff";
  if (b.endsWith(".svg")) return "image/svg+xml";
  if (b.endsWith(".xml") || b.endsWith(".ims") || b.endsWith(".mobileconfig")) return "application/xml";
  if (b.endsWith(".crt") || b.endsWith(".cer") || b.endsWith(".pem")) return "application/x-x509-ca-cert";
  if (b.endsWith(".plist") || b.endsWith(".strings") || b.endsWith(".loctable")) return "application/x-plist";
  if (b.endsWith(".caf")) return "audio/x-caf";
  if (b.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

/** Short explanation of what a member is, shown next to the file list. */
export const KIND_NOTES: Record<string, string> = {
  ".prl": "CDMA Preferred Roaming List, a binary system-selection table",
  ".dmu": "Dynamic Mobile IP Key Update (DMU) RSA public key",
  ".mcfopota": "OP-OTA modem configuration blob",
  ".metadata": "base64-encoded JSON left behind by Apple's bundle packager",
  ".ims": "Qualcomm IMS stack configuration (QIMF XML)",
  ".xml": "OMA-DM management tree",
};

export interface BundleFile {
  /** Path relative to the .bundle root. */
  path: string;
  size: number;
  kind: FileKind;
  /** lproj locale when the file lives in a localisation folder. */
  locale?: string;
  /** Devices the file applies to, for overrides_* files. */
  devices?: DeviceRef[];
}

export interface BundleInfo {
  bundleName: string;
  files: BundleFile[];
  /** Total uncompressed bytes. */
  totalSize: number;
  locales: string[];
  deviceStems: string[];
}

export type DeviceRef = { code: string; name?: string; ids?: string };

/** CMS SignedData envelope of a signed profile, without its content. */
export type CmsSignature = Omit<CmsSignedData, "content">;

/** Why a member did not decode as its name says: the decoder threw, or the bytes are not that format. */
export interface DecodeError {
  reason: "failed" | "unrecognised";
  message?: string;
}

interface DecodedCommon {
  path: string;
  size: number;
  devices?: DeviceRef[];
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

/** The decoded PRI of a `.der.pri` / `.der.gri` member (or a DER one under a plain name). */
export const decodedPri = (d: DecodedFile): PriDecoded | undefined => (d.kind === "pri-der" ? d.pri : undefined);

/** Hex shown for a member with no better view; at most 8 KiB of it. */
const HEX_PREVIEW = 8192;
const failed = (e: unknown): DecodeError => ({ reason: "failed", message: e instanceof Error ? e.message : String(e) });

function classify(path: string): FileKind {
  const base = path.split("/").pop() ?? path;
  if (base.endsWith(".der.pri") || base.endsWith(".der.gri")) return "pri-der";
  if (base.endsWith(".pri") || base.endsWith(".gri")) return "pri-plain";
  if (base.endsWith(".strings")) return "strings";
  if (base.endsWith(".mobileconfig")) return "mobileconfig";
  if (base.endsWith(".plist") || base.endsWith(".loctable")) return "plist";
  if (base.endsWith(".prl")) return "prl";
  if (base.endsWith(".dmu")) return "dmu";
  if (base.endsWith(".caf")) return "audio";
  if (base.endsWith(".xml") || base.endsWith(".ims")) return "xml";
  if (base.endsWith(".crt") || base.endsWith(".cer") || base.endsWith(".pem")) return "certificate";
  if (/\.(png|jpe?g|gif|tiff?|svg)$/.test(base.toLowerCase())) return "image";
  if (base.endsWith(".metadata")) return "metadata";
  return "binary";
}

function localeOf(path: string): string | undefined {
  const m = /(?:^|\/)([A-Za-z0-9_-]+)\.lproj\//.exec(path);
  return m ? m[1] : undefined;
}

function deviceStem(path: string): string | undefined {
  const base = path.split("/").pop() ?? "";
  const m = /^overrides_(.+?)\.(der\.pri|der\.gri|plist|pri)$/.exec(base);
  return m ? m[1] : undefined;
}

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
    if (m) { prefix = m[1]; break; }
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
    const size = zip[n].length;
    totalSize += size;
    const loc = localeOf(rel);
    if (loc) locales.add(loc);
    const stem = deviceStem(rel);
    if (stem) stems.add(stem);
    files.push({
      path: rel,
      size,
      kind: classify(rel),
      locale: loc,
      devices: stem ? describeDevices(stem) : undefined,
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
  const stem = deviceStem(relPath);
  const base: DecodedCommon = { path: relPath, size: bytes.length, ...(stem ? { devices: describeDevices(stem) } : {}) };
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
  const priKind = base.path.endsWith(".gri") ? "der.gri" : "der.pri";
  if (kind === "pri-der") return { ...base, kind, pri: decodePri(bytes, priKind) };
  if (isPlistKind(kind)) {
    if (kind === "metadata") {
      // Base64-encoded JSON written by Apple's packaging tool.
      try {
        return { ...base, kind, plist: JSON.parse(atob(td.decode(bytes).replace(/\s+/g, ""))) as unknown };
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
      for (const der of pemBlocks(text)) {
        try { certificates.push(parseCertificate(der)); } catch { /* listed in the text regardless */ }
      }
      // corpus: some CarrierCA.crt files are `openssl x509 -subject -issuer` output wrapping the PEM
      return { ...base, kind, text, certificates, ...(text.startsWith("-----BEGIN") ? {} : { note: "PEM with OpenSSL subject/issuer lines" }) };
    }
    case "prl":
      try {
        return { ...base, kind, hex: preview(), prl: decodePrl(bytes) };
      } catch (e) {
        return { ...base, kind, hex: preview(), note: KIND_NOTES[".prl"], error: failed(e) };
      }
    case "dmu":
      try {
        return { ...base, kind, hex: preview(), dmu: decodeDmu(bytes) };
      } catch (e) {
        return { ...base, kind, hex: preview(), note: KIND_NOTES[".dmu"], error: failed(e) };
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
 * byte order of path. scripts/package_system_bundles.py computes the same value
 * and uses it as the R2 key, so this doubles as the integrity check.
 */
export async function contentId(b: OpenedBundle): Promise<string> {
  const enc = new TextEncoder();
  // WebCrypto's BufferSource wants an ArrayBuffer-backed view; zip entries are.
  const hex = async (bytes: Uint8Array) => bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));
  const byBytes = (x: Uint8Array, y: Uint8Array) => {
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  };
  const files = b.info.files
    .filter((f) => !f.path.endsWith(".DS_Store"))
    .map((f) => ({ path: enc.encode(f.path), bytes: b.entries[b.prefix + f.path] }))
    .sort((x, y) => byBytes(x.path, y.path));
  const digests = await Promise.all(files.map((f) => hex(f.bytes)));
  const lines = files.flatMap((f, i) => [f.path, enc.encode("\0" + digests[i] + "\n")]);
  const all = new Uint8Array(lines.reduce((n, l) => n + l.length, 0));
  let at = 0;
  for (const l of lines) { all.set(l, at); at += l.length; }
  return hex(all);
}

export const base64Of = (bytes: Uint8Array): string => btoa(latin1(bytes));
