import { resolve } from "$app/paths";
import type { ReadonlyURL } from "$app/state";
import type { Path } from "$app/types";
import { bandList, isBigInt, isRecord, isUid, type ComboComponent, type DiffKind } from "#lib/decode/index.ts";
import { sourceKey, type Platform, type SourceRef } from "#lib/schema/types.ts";
import type { Place, Version } from "#lib/types.ts";
import { segmentOf } from "#lib/places.ts";

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

type Labelled = Pick<Version, "via" | "os" | "version" | "productType" | "slug">;

/** iOS: which images carry it or which OS it is published for, the bundle's build, and the model a per-model copy is for. */
function iosLabel(e: Labelled): string {
  // Every Watch bundle is for Watch; only the iPad and single-model variants need saying.
  const model = e.productType && e.productType !== "Watch" ? " · " + e.productType : "";
  const [first, last] = [e.os[0], e.os.at(-1)];
  if (e.via === "ota") return `OTA · ${first !== undefined ? `iOS ${first}+` : "legacy"} · build ${e.version}${model}`;
  const ios = first !== undefined && last !== undefined && e.os.length > 1 ? iosRange(first, last) : (first ?? "");
  return `iOS ${ios} image · build ${e.version}${model}`;
}

/** Android: the release, its build id, and the file's own version. */
const androidLabel = (e: Labelled): string =>
  `Android ${e.os.join(", ")} · ${e.slug.replace(/^android-/, "").toUpperCase()} · version ${e.version}`;

const LABELS = { ios: iosLabel, android: androidLabel } as const satisfies Record<Platform, (e: Labelled) => string>;

/** Where a version came from: the one label used by the version picker, Overview and Compare. */
export const entryLabel = (e: Labelled, platform: Platform): string => LABELS[platform](e);

/** Chip class for each kind of difference. */
export const DIFF_CHIP: Record<DiffKind, string> = { added: "good", removed: "bad", changed: "warn", same: "" };

/** "n77A", "b66A↑A": one band-combo component, with its uplink class unless `uplink` is off. */
export const comboPart = (c: ComboComponent, uplink = true) =>
  bandList([c.band], c.rat) + c.dl + (uplink && c.ul ? "↑" + c.ul : "");

const seg = encodeURIComponent;
const segs = (path: string) => path.split("/").map(seg).join("/");

/** Every internal link goes through here so a configured base path is honoured. */
export const link = (path: string) => resolve(path.slice(1) as Path);

/** A modem package page of an iOS build, or one of its tabs. */
export const modemHref = (build: string, family: string, tab?: string): string =>
  link(`/builds/${seg(build)}/${seg(family)}` + (tab ? `/${tab}` : ""));

/** A carrier's or a country's overview. */
export const placeHref = (p: Place, query = ""): string => link(`/${p.group}/${seg(p.id)}`) + query;

/** A native view: a source at a version, on one tab, at one file. Without a version, the source's head. */
export function nativeHref(p: Place, ref: SourceRef, version?: string, tab?: string, path?: string): string {
  const base = `/${p.group}/${seg(p.id)}/${ref.platform}/${seg(segmentOf(p.group, ref))}`;
  if (!version) return link(base);
  return link(`${base}/${seg(version)}` + (tab ? `/${tab}` : "") + (tab && path ? `/${segs(path)}` : ""));
}

/**
 * Any source by its key, wherever its pages live: /source resolves the key to
 * its carrier or country and redirects. For links that only have a key (scan
 * results, release lists, the SIM table, the wiki) without loading where each lives.
 */
export const sourceHref = (key: string, opts: { version?: string; tab?: string; path?: string; release?: string } = {}): string =>
  link(`/source/${seg(key)}` + (opts.version ? `/${seg(opts.version)}` : "") + (opts.tab ? `/${opts.tab}` : "") + (opts.tab && opts.path ? `/${segs(opts.path)}` : ""))
  + (opts.release ? `?release=${seg(opts.release)}` : "");

/** An iOS carrier bundle by name, for the tables that only know Apple's names (the manifest's SIM rules, modem carrier maps). */
export const iosBundleHref = (name: string, family?: "Watch"): string =>
  sourceHref(sourceKey({ platform: "ios", kind: "carrier", name, ...(family ? { family } : {}) }));

/** One side of a comparison: a source, at a version or at its head. */
export interface SideRef {
  readonly source: string;
  readonly slug?: string | undefined;
}

/** `ios:carrier:ATT_US@ota-72.1`: a side as /compare's query names it. */
export const sideParam = (s: SideRef): string => (s.slug ? `${s.source}@${s.slug}` : s.source);

export function parseSide(param: string | null): SideRef | null {
  if (!param) return null;
  const at = param.lastIndexOf("@");
  return at > 0 ? { source: param.slice(0, at), slug: param.slice(at + 1) } : { source: param };
}

/** /compare with two sides, either of which may be left for the reader to pick, narrowed to one file or not. */
export function compareHref(a: SideRef | null, b: SideRef | null, file?: string | null): string {
  const q = new URLSearchParams();
  if (a) q.set("a", sideParam(a));
  if (b) q.set("b", sideParam(b));
  if (file) q.set("file", file);
  return link("/compare") + (q.size ? "?" + q : "");
}

/** Only images and audio: the pages embed those, every other file is shown decoded. */
export const rawHref = (key: string, version: string, path: string): string =>
  link(`/raw/${seg(key)}/${seg(version)}/${segs(path)}`);

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
