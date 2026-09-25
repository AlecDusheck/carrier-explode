import { resolve } from "$app/paths";
import type { Kind, PublicEntry } from "$lib/server/data";

export function humanBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KiB";
  return (n / 1024 / 1024).toFixed(2) + " MiB";
}

export const isBigInt = (v: unknown): v is { __int: string } =>
  !!v && typeof v === "object" && typeof (v as { __int?: unknown }).__int === "string";
export const isUid = (v: unknown): v is { __uid: number } =>
  !!v && typeof v === "object" && typeof (v as { __uid?: unknown }).__uid === "number";

/** JSON with plist integers beyond 2^53 written as bare digits and UIDs as UID(n). */
export function plainJson(v: unknown, indent?: number): string {
  const s = JSON.stringify(
    v,
    (_, x) => (isBigInt(x) ? "\u0001" + x.__int + "\u0001" : isUid(x) ? "\u0001UID(" + x.__uid + ")\u0001" : x),
    indent,
  );
  return s === undefined ? String(v) : s.replace(/"\\u0001(.*?)\\u0001"/g, "$1");
}

export function shortValue(v: unknown, max = 160): string {
  if (v === undefined) return "absent";
  if (v === null) return "null";
  const s = typeof v === "string" ? v : plainJson(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Where a version came from: the one label used by the timeline, Summary and Compare. */
export function entryLabel(e: Pick<PublicEntry, "source" | "ios" | "build" | "productType">): string {
  // Every Watch bundle is for Watch; only the iPad and single-model variants need saying.
  const model = e.productType && e.productType !== "Watch" ? " · " + e.productType : "";
  if (e.source === "image") {
    const ios = e.ios.length > 1 ? `${e.ios[0]} – ${e.ios.at(-1)}` : e.ios[0];
    return `iOS ${ios} image · build ${e.build}${model}`;
  }
  return `OTA · ${e.ios.length ? `iOS ${e.ios[0]}+` : "legacy"} · build ${e.build}${model}`;
}

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
  const x = e as { status?: number; body?: { message?: string }; message?: string } | null;
  const said = x?.body?.message ?? x?.message;
  if (said) return said;
  // Anything that arrives in another shape still has to say something: String()
  // on a bare object renders "[object Object]", which tells nobody anything.
  let shape: string;
  try {
    shape = typeof e === "object" && e !== null ? JSON.stringify(e) : String(e);
  } catch {
    shape = String(e);
  }
  return x?.status ? `HTTP ${x.status} · ${shape}` : `Unexpected error: ${shape}`;
}

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
