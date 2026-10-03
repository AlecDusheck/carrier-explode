import { resolve } from "$app/paths";
import type { ReadonlyURL } from "$app/state";
import type { Path } from "$app/types";
import { bandList, isBigInt, isRecord, isUid, type ComboComponent, type DiffKind } from "#lib/decode/index.ts";
import { sourceKey, versionPath, type ConceptValue, type Platform, type SourceRef } from "#lib/schema/types.ts";
import type { At, Version } from "#lib/types.ts";

export function humanBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KiB";
  return (n / 1024 / 1024).toFixed(2) + " MiB";
}

/** JSON with plist integers beyond 2^53 written as bare digits and UIDs as UID(n). */
export function plainJson(v: unknown, indent?: number): string {
  const step = indent ? " ".repeat(indent) : "";
  const block = (open: string, close: string, items: string[], at: string) => {
    if (!items.length) return open + close;
    if (!step) return open + items.join(",") + close;
    const inner = at + step;
    return `${open}\n${inner}${items.join(",\n" + inner)}\n${at}${close}`;
  };
  const write = (x: unknown, at: string): string | undefined => {
    if (isBigInt(x)) return x.__int;
    if (isUid(x)) return `UID(${x.__uid})`;
    if (Array.isArray(x)) return block("[", "]", x.map((y) => write(y, at + step) ?? "null"), at);
    if (isRecord(x)) {
      const items = Object.entries(x).flatMap(([k, y]) => {
        const s = write(y, at + step);
        return s === undefined ? [] : [JSON.stringify(k) + (step ? ": " : ":") + s];
      });
      return block("{", "}", items, at);
    }
    // undefined and functions have no JSON form, as with JSON.stringify.
    const s: string | undefined = JSON.stringify(x);
    return s;
  };
  return write(v, "") ?? String(v);
}

export function shortValue(v: unknown, max = 160): string {
  if (v === undefined) return "absent";
  if (v === null) return "null";
  const s = typeof v === "string" ? v : plainJson(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** "27.2 beta 1–2" for betas of one release, else "26.6 – 26.6.2". */
function iosRange(first: string, last: string): string {
  const [a, b] = [/^(.+ beta)(?: (\d+))?$/.exec(first), /^(.+ beta) (\d+)$/.exec(last)];
  return a && b && a[1] === b[1] ? `${a[1]} ${a[2] ?? 1}–${b[2]}` : `${first} – ${last}`;
}

type Labelled = Pick<Version, "images" | "ota" | "version">;

/** Apple: the images carrying it and the OS its OTA copy is published for, then the bundle's own version. */
const appleLabel = (os: string) => (e: Labelled): string => {
  const [first, last] = [e.images[0], e.images.at(-1)];
  const image = first === undefined || last === undefined ? [] : [`${os} ${first === last ? first : iosRange(first, last)} image`];
  const ota = e.ota.length ? [`OTA${e.ota[0] ? ` ${os} ${e.ota[0]}+` : ""}`] : [];
  return `${[...image, ...ota].join(" + ")} · build ${e.version}`;
};

/** Android: the newest release carrying it, and the file's own version. */
const androidLabel = (e: Labelled): string => `Android ${e.images.at(-1) ?? ""} · version ${e.version}`;

const LABELS = {
  ios: appleLabel("iOS"),
  ipados: appleLabel("iPadOS"),
  watchos: appleLabel("watchOS"),
  android: androidLabel,
} as const satisfies Record<Platform, (e: Labelled) => string>;

/** Where a version came from: the one label used by the version strip, the Overview and Compare. */
export const entryLabel = (e: Labelled & { readonly platform: Platform }): string => LABELS[e.platform](e);

/** A concept's reading as text; absent means the platform cannot express it. */
export function conceptText(v: ConceptValue | undefined): string {
  if (!v) return "not expressible";
  if (v.kind === "unset") return "not set";
  return v.kind === "state" ? v.state : shortValue(v.value, 120);
}

/** Chip class for each kind of difference. */
export const DIFF_CHIP: Record<DiffKind, string> = { added: "good", removed: "bad", changed: "warn", same: "" };

/** "n77A", "b66A↑A": one band-combo component, with its uplink class unless `uplink` is off. */
export const comboPart = (c: ComboComponent, uplink = true): string =>
  bandList([c.band], c.rat) + c.dl + (uplink && c.ul ? "↑" + c.ul : "");

const seg = encodeURIComponent;
const segs = (path: string): string => path.split("/").map(seg).join("/");

/** Every internal link goes through here so a configured base path is honoured. Paths come from this module or the schema's path builders. */
export const link = (path: string): string => resolve(path.slice(1) as Path);

/** A modem package page of an iOS build, or one of its tabs. */
export const modemHref = (build: string, family: string, tab?: string): string =>
  link(`/builds/${seg(build)}/${seg(family)}` + (tab ? `/${tab}` : ""));

/** A version's page, on a tab, at a file. */
export function versionHref(at: At, tab?: string, path?: string): string {
  const base = versionPath(at.ref, at.version, at.line);
  return link(base + (tab ? `/${tab}` : "") + (tab && path ? `/${segs(path)}` : ""));
}

/** One side of /compare: a source, at a version on a line, or at its head. */
export interface CompareSide {
  readonly source: SourceRef;
  readonly slug?: string | undefined;
  readonly line?: string | undefined;
}

/** /compare's query for two sides (`a=ios:carrier:ATT_US&av=72.0`, `b=android:carrier:att_us&bl=tokay&bv=79000000034`), narrowed to a file or not. */
export function compareHref(a: CompareSide | null, b: CompareSide | null, file?: string | null): string {
  const q = new URLSearchParams();
  for (const [p, s] of [["a", a], ["b", b]] as const) {
    if (!s) continue;
    q.set(p, sourceKey(s.source));
    if (s.line) q.set(`${p}l`, s.line);
    if (s.slug) q.set(`${p}v`, s.slug);
  }
  if (file) q.set("file", file);
  return link("/compare") + (q.size ? "?" + q : "");
}

/** The query args naming a version. */
export const verArgs = (at: At): { source: string; line?: string; slug: string } =>
  at.line === undefined ? { source: at.source, slug: at.version } : { source: at.source, line: at.line, slug: at.version };

/** Only images and audio: the pages embed those, every other file is shown decoded. */
export const rawHref = (at: At, path: string): string => link(`/raw${versionPath(at.ref, at.version, at.line)}/${segs(path)}`);

export function errorMessage(e: unknown): string {
  const x = isRecord(e) ? e : {};
  const body = isRecord(x.body) ? x.body : {};
  const said = typeof body.message === "string" ? body.message : typeof x.message === "string" ? x.message : undefined;
  if (said) return said;
  // Anything that arrives in another shape still has to say something: String()
  // on a bare object renders "[object Object]", which tells nobody anything.
  let shape: string;
  try {
    shape = typeof e === "object" && e !== null ? JSON.stringify(e) : String(e);
  } catch {
    shape = String(e);
  }
  return typeof x.status === "number" && x.status ? `HTTP ${x.status} · ${shape}` : `Unexpected error: ${shape}`;
}

/** The first 32 bytes of a hex string; some defaults are whole tables, and the name says what they are. */
export const shortHex = (hex: string) => (hex.length > 64 ? hex.slice(0, 64) + "…" : hex);

export function hexDump(hex: string, withOffsets = false): string {
  return (hex.match(/.{1,32}/g) ?? [])
    .map((g, i) => {
      const bytes = g.match(/.{1,2}/g) ?? [];
      if (!withOffsets) return bytes.join(" ");
      const ascii = bytes
        .map((b) => {
          const c = parseInt(b, 16);
          return c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
        })
        .join("");
      return (i * 16).toString(16).padStart(6, "0") + "  " + bytes.join(" ").padEnd(47) + "  " + ascii;
    })
    .join("\n");
}

/** Same URL with some search params changed; empty values are dropped. */
export function withParams(url: ReadonlyURL, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(url.search);
  for (const [k, v] of Object.entries(changes)) {
    if (v) next.set(k, v);
    else next.delete(k);
  }
  const q = next.toString();
  return url.pathname + (q ? "?" + q : "");
}
