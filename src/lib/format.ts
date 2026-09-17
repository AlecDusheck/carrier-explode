import { resolve } from "$app/paths";
import type { Kind, PublicEntry } from "$lib/server/data";

export function humanBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KiB";
  return (n / 1024 / 1024).toFixed(2) + " MiB";
}

export function shortValue(v: unknown, max = 160): string {
  if (v === undefined) return "absent";
  if (v === null) return "null";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Where a version came from: the one label used by the timeline, Summary and Compare. */
export function entryLabel(e: Pick<PublicEntry, "source" | "ios" | "build" | "productType">): string {
  const model = e.productType ? " · " + e.productType : "";
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

export const downloadHref = (kind: Kind, name: string, slug: string) =>
  link(`/download/${kind}/${seg(name)}/${seg(slug)}`);

/** Query args must be built the same way everywhere so layout and page share one cached query. */
export const bundleArgs = (p: { kind: Kind; name: string; version?: string }) =>
  p.version ? { kind: p.kind, name: p.name, slug: p.version } : { kind: p.kind, name: p.name };

export function errorMessage(e: unknown): string {
  const x = e as { body?: { message?: string }; message?: string } | null;
  return x?.body?.message ?? x?.message ?? String(e);
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
