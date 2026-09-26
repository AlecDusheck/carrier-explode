import { resolve } from "$app/paths";
import { bandList, isBigInt, isRecord, isUid, type ComboComponent, type DiffKind } from "$lib/decode";
import type { CbsRow, Kind, PublicEntry } from "$lib/types";

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

/** Where a version came from: the one label used by the timeline, Summary and Compare. */
export function entryLabel(e: Pick<PublicEntry, "source" | "ios" | "build" | "productType">): string {
  // Every Watch bundle is for Watch; only the iPad and single-model variants need saying.
  const model = e.productType && e.productType !== "Watch" ? " · " + e.productType : "";
  if (e.source === "image") {
    const ios = e.ios.length > 1 ? iosRange(e.ios[0], e.ios.at(-1)!) : e.ios[0];
    return `iOS ${ios} image · build ${e.build}${model}`;
  }
  return `OTA · ${e.ios.length ? `iOS ${e.ios[0]}+` : "legacy"} · build ${e.build}${model}`;
}

/** A cell-broadcast row's bundle in entryLabel's words: the current image's copy, or an OTA one. */
export function cbsEntryLabel(r: Pick<CbsRow, "source" | "version" | "minOS">, image: { version: string } | null): string {
  return entryLabel(
    r.source === "image" && image
      ? { source: "image", ios: [image.version], build: r.version }
      : { source: "ota", ios: r.minOS ? [r.minOS] : [], build: r.version },
  );
}

/** Chip class for each kind of difference. */
export const DIFF_CHIP: Record<DiffKind, string> = { added: "good", removed: "bad", changed: "warn", same: "" };

/** "n77A", "b66A↑A": one band-combo component, with its uplink class unless `uplink` is off. */
export const comboPart = (c: ComboComponent, uplink = true) =>
  bandList([c.band], c.rat) + c.dl + (uplink && c.ul ? "↑" + c.ul : "");

const seg = encodeURIComponent;
const segs = (path: string) => path.split("/").map(seg).join("/");

/** Every internal link goes through here so a configured base path is honoured. */
export const link = (path: string) => resolve(path as `/${string}`);

export const bundleHref = (kind: Kind, name: string, slug?: string, tab?: string) =>
  link(`/${kind}/${seg(name)}` + (slug ? `/${seg(slug)}` + (tab ? `/${tab}` : "") : ""));

export const fileHref = (kind: Kind, name: string, slug: string, path: string) =>
  `${bundleHref(kind, name, slug, "files")}/${segs(path)}`;

export const rawHref = (kind: Kind, name: string, slug: string, path: string, download = false) =>
  link(`/raw/${kind}/${seg(name)}/${seg(slug)}/${segs(path)}`) + (download ? "?dl" : "");


/** Query args must be built the same way everywhere so layout and page share one cached query. */
export const bundleArgs = (p: { kind: Kind; name: string; version?: string }) =>
  p.version ? { kind: p.kind, name: p.name, slug: p.version } : { kind: p.kind, name: p.name };

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
export function withParams(url: URL, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(url.searchParams);
  for (const [k, v] of Object.entries(changes)) {
    if (v) next.set(k, v);
    else next.delete(k);
  }
  const q = next.toString();
  return url.pathname + (q ? "?" + q : "");
}
