/**
 * IPCC container reader. An .ipcc is a plain (unencrypted) ZIP holding
 * `Payload/<Name>.bundle/...`.
 */

import { unzipSync } from "fflate";
import { parsePlist, toJsonSafe, bytesToHex, maybeText } from "./plist";
import { decodePri, type PriDecoded } from "./pri";
import { describeDevices } from "./devices";
import { pngDimensions, isCgBI } from "./png";
import { decodePrl, describePrl, type PrlDecoded } from "./prl";
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
  devices?: Array<{ code: string; name?: string; ids?: string }>;
}

export interface BundleInfo {
  bundleName: string;
  files: BundleFile[];
  /** Total uncompressed bytes. */
  totalSize: number;
  locales: string[];
  deviceStems: string[];
}

export interface DecodedFile {
  path: string;
  kind: FileKind;
  size: number;
  plist?: unknown;
  pri?: PriDecoded;
  text?: string;
  hex?: string;
  note?: string;
  devices?: Array<{ code: string; name?: string; ids?: string }>;
  /** CDMA Preferred Roaming List, for kind "prl". */
  prl?: PrlDecoded;
  /** CMS SignedData envelope of a signed profile; `plist` holds the content. */
  signature?: Omit<CmsSignedData, "content">;
  /** X.509 certificates found in the file. */
  certificates?: CertInfo[];
  /** DMU public key, for kind "dmu". */
  dmu?: DmuKey;
  /** Audio format, for kind "audio". */
  audio?: CafInfo;
}

const certLine = (c: CertInfo) =>
  `${c.subject}${c.selfIssued ? " (self-issued)" : `, issued by ${c.issuer}`}, valid ${c.notBefore.slice(0, 10)} to ${c.notAfter.slice(0, 10)}`;

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
  const key = b.prefix + relPath;
  const bytes = b.entries[key] ?? b.entries[relPath];
  if (!bytes) throw new Error(`no such file in bundle: ${relPath}`);
  const kind = classify(relPath);
  const stem = deviceStem(relPath);
  const devices = stem ? describeDevices(stem) : undefined;
  const out: DecodedFile = { path: relPath, kind, size: bytes.length, devices };

  try {
    switch (kind) {
      case "plist":
      case "strings":
      case "mobileconfig":
      case "pri-plain": {
        // Some `.pri` files are plists; a few are raw XML documents; the legacy
        // `.strings` format is plain text. Signed profiles are CMS-wrapped plists.
        if (isCmsSignedData(bytes)) {
          const { content, ...sig } = parseSignedData(bytes);
          out.signature = sig;
          out.plist = toJsonSafe(parsePlist(content));
          const signer = sig.signers[0];
          const cert = signer?.certificate !== undefined ? sig.certificates[signer.certificate] : undefined;
          out.note = `signed profile (CMS SignedData, ${signer?.digestAlgorithm ?? "no signer"})` +
            (cert ? `; signer ${certLine(cert)}` : signer?.issuer ? `; signer issued by ${signer.issuer}` : "") +
            (signer?.signingTime ? `; signed ${signer.signingTime}` : "") +
            "; signature not verified";
          break;
        }
        const head = td.decode(bytes.subarray(0, 8));
        if (head.startsWith("bplist") || /^\s*<(\?xml|!DOCTYPE|plist)/.test(head)) {
          out.plist = toJsonSafe(parsePlist(bytes));
          break;
        }
        // A few OTA `overrides_*.pri` are the DER form under the plain name.
        if (kind === "pri-plain" && bytes[0] === 0x31) {
          out.pri = decodePri(bytes, relPath.endsWith(".gri") ? "der.gri" : "der.pri");
          break;
        }
        const text = maybeText(bytes) ?? (isMostlyText(bytes) ? td.decode(bytes) : undefined);
        if (text !== undefined) {
          out.text = text;
        } else {
          // Not a plist and not text: say so instead of returning replacement
          // characters that look like a successful decode.
          out.note = `not a plist and not text; showing raw bytes`;
          out.hex = bytesToHex(bytes.subarray(0, 8192));
        }
        break;
      }
      case "pri-der":
        out.pri = decodePri(bytes, relPath.endsWith(".der.gri") ? "der.gri" : "der.pri");
        break;
      case "xml":
        out.text = td.decode(bytes);
        break;
      case "metadata": {
        // Base64-encoded JSON written by Apple's packaging tool.
        try {
          const json = atob(td.decode(bytes).replace(/\s+/g, ""));
          out.plist = JSON.parse(json) as unknown;
        } catch {
          out.text = td.decode(bytes);
          out.note = "expected base64-encoded JSON";
        }
        break;
      }
      case "certificate": {
        if (bytes[0] === 0x30) {
          out.hex = bytesToHex(bytes);
          try {
            out.certificates = [parseCertificate(bytes)];
            out.note = `DER-encoded X.509 certificate: ${certLine(out.certificates[0])}`;
          } catch (e) {
            out.note = `DER-encoded X.509 certificate; could not parse: ${(e as Error).message}`;
          }
          break;
        }
        const text = td.decode(bytes);
        out.text = text;
        const certs: CertInfo[] = [];
        for (const der of pemBlocks(text)) {
          try { certs.push(parseCertificate(der)); } catch { /* listed in the text regardless */ }
        }
        if (certs.length) out.certificates = certs;
        // corpus: some CarrierCA.crt files are `openssl x509 -subject -issuer` output wrapping the PEM
        const form = text.startsWith("-----BEGIN") ? "PEM-encoded" : "PEM with OpenSSL subject/issuer lines,";
        out.note = certs.length === 1
          ? `${form} X.509 certificate: ${certLine(certs[0])}`
          : `${form} ${certs.length} X.509 certificates`;
        break;
      }
      case "prl":
        out.hex = bytesToHex(bytes.subarray(0, 8192));
        try {
          out.prl = decodePrl(bytes);
          out.note = describePrl(out.prl);
        } catch (e) {
          out.note = `${KIND_NOTES[".prl"]}; could not decode: ${(e as Error).message}`;
        }
        break;
      case "dmu":
        out.hex = bytesToHex(bytes.subarray(0, 8192));
        try {
          const k = (out.dmu = decodeDmu(bytes));
          out.note = `DMU public key: ${k.algorithm}, exponent ${k.exponent}, PKOID 0x${k.pkoid.toString(16).padStart(2, "0")}` +
            (k.pkoidName ? ` (${k.pkoidName})` : "") + `, PKOI ${k.pkoi}`;
        } catch (e) {
          out.note = `${KIND_NOTES[".dmu"]}; could not decode: ${(e as Error).message}`;
        }
        break;
      case "audio": {
        if (!isCaf(bytes)) { out.note = "audio"; break; }
        const a = (out.audio = decodeCaf(bytes));
        out.note = `Core Audio file: ${a.format.trim()}${a.encoding ? ` (${a.bitsPerChannel}-bit ${a.encoding})` : ""}, ` +
          `${a.sampleRate} Hz, ${a.channels} channel${a.channels === 1 ? "" : "s"}` +
          (a.duration !== undefined ? `, ${a.duration} s` : "");
        break;
      }
      case "image": {
        // The raw bytes are served by /api/raw; only the shape is useful here.
        const dim = pngDimensions(bytes);
        out.note = dim
          ? `PNG, ${dim.width} by ${dim.height} pixels` +
            (isCgBI(bytes) ? "; Apple CgBI form, converted to standard PNG when served" : "")
          : "image";
        break;
      }
      default: {
        const t = maybeText(bytes) ?? wholeText(bytes);
        const ext = "." + (relPath.split("/").pop() ?? "").split(".").slice(1).join(".");
        const known = KIND_NOTES[ext] ?? KIND_NOTES["." + ext.split(".").pop()];
        if (t) {
          out.text = t;
          if (known) out.note = known;
        } else {
          out.hex = bytesToHex(bytes.subarray(0, 8192));
          out.note = [known, bytes.length > 8192 ? `showing the first 8 KiB of ${bytes.length} bytes` : null]
            .filter(Boolean)
            .join("; ") || undefined;
        }
      }
    }
  } catch (e) {
    out.note = `decode failed: ${(e as Error).message}`;
    out.hex = bytesToHex(bytes.subarray(0, 2048));
  }
  return out;
}

/**
 * A bundle's identity: sha256 over "path NUL sha256(bytes) LF" for every file, in
 * byte order of path. scripts/package_system_bundles.py computes the same value
 * and uses it as the R2 key, so this doubles as the integrity check.
 */
export async function contentId(b: OpenedBundle): Promise<string> {
  const enc = new TextEncoder();
  const hex = async (bytes: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer))]
      .map((x) => x.toString(16).padStart(2, "0")).join("");
  const byBytes = (x: Uint8Array, y: Uint8Array) => {
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  };
  const files = b.info.files
    .filter((f) => !f.path.endsWith(".DS_Store"))
    .map((f) => ({ path: enc.encode(f.path), bytes: b.entries[b.prefix + f.path] }))
    .sort((x, y) => byBytes(x.path, y.path));
  const lines: Uint8Array[] = [];
  for (const f of files) lines.push(f.path, enc.encode("\0" + (await hex(f.bytes)) + "\n"));
  const all = new Uint8Array(lines.reduce((n, l) => n + l.length, 0));
  let at = 0;
  for (const l of lines) { all.set(l, at); at += l.length; }
  return hex(all);
}

export function base64Of(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
