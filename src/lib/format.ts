import { resolve } from "$app/paths";
import type { ReadonlyURL } from "$app/state";
import type { Path } from "$app/types";
import { bandList, isBigInt, isRecord, isUid, type ComboComponent, type DiffKind } from "#lib/decode/index.ts";
import type { Platform } from "#lib/schema/types.ts";
import type { At, Kind, Version } from "#lib/types.ts";

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

type Labelled = Pick<Version, "via" | "os" | "version" | "productType" | "slug" | "phones">;

/** iOS: which images carry it or which OS it is published for, the bundle's build, and the model a per-model copy is for. */
function iosLabel(e: Labelled): string {
  // Every Watch bundle is for Watch; only the iPad and single-model variants need saying.
  const model = e.productType && e.productType !== "Watch" ? " · " + e.productType : "";
  const [first, last] = [e.os[0], e.os.at(-1)];
  if (e.via === "ota") return `OTA · ${first !== undefined ? `iOS ${first}+` : "legacy"} · build ${e.version}${model}`;
  const ios = first !== undefined && last !== undefined && e.os.length > 1 ? iosRange(first, last) : (first ?? "");
  return `iOS ${ios} image · build ${e.version}${model}`;
}

/** Android: the release, the file's own version, and the Pixels it is for. */
const androidLabel = (e: Labelled): string =>
  `Android ${e.os.at(-1) ?? ""} image · version ${e.version}` + (e.phones?.length ? ` · ${shortPhones(e.phones)}` : "");

/** "Pixel 9, 9 Pro, 9 Pro XL": the shared "Pixel " said once. */
const shortPhones = (names: readonly string[]): string =>
  names.map((n, i) => (i && n.startsWith("Pixel ") ? n.slice(6) : n)).join(", ");

const LABELS = { ios: iosLabel, android: androidLabel } as const satisfies Record<Platform, (e: Labelled) => string>;

/** Where a version came from: the one label used by the timeline, Summary and Compare. */
export const entryLabel = (e: Labelled & { readonly platform: Platform }): string => LABELS[e.platform](e);

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

export const bundleHref = (kind: Kind, name: string, slug?: string, tab?: string): string =>
  link(`/${kind}/${seg(name)}` + (slug ? `/${seg(slug)}` + (tab ? `/${tab}` : "") : ""));

export const fileHref = (kind: Kind, name: string, slug: string, path: string): string =>
  `${bundleHref(kind, name, slug, "files")}/${segs(path)}`;

/** Only images and audio: the pages embed those, every other file is shown decoded. */
export const rawHref = (kind: Kind, name: string, slug: string, path: string): string =>
  link(`/raw/${kind}/${seg(name)}/${seg(slug)}/${segs(path)}`);

/** Query args must be built the same way everywhere so layout and page share one cached query. */
export const bundleArgs = (p: { kind: Kind; name: string; version?: string | undefined }): { kind: Kind; name: string; slug?: string } =>
  p.version ? { kind: p.kind, name: p.name, slug: p.version } : { kind: p.kind, name: p.name };

/** A tab body's query args: its page at its version. */
export const atArgs = (at: At): { kind: Kind; name: string; slug: string } => ({ kind: at.kind, name: at.name, slug: at.version });

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
