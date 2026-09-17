import type { ManifestIndex, CarrierSummary, BundleRef, MccMncEntry, CountrySummary } from "../../worker/lib/manifest.ts";
import type { BundleInfo, DecodedFile } from "../../worker/lib/ipcc.ts";
import type { CbsRow } from "../../worker/lib/cbs.ts";
import type { DiffRow } from "../../worker/lib/diff.ts";
import type { ScanResult } from "../../worker/lib/keyscan.ts";

export type {
  ManifestIndex, CarrierSummary, BundleRef, MccMncEntry, CountrySummary,
  BundleInfo, DecodedFile, CbsRow, DiffRow, ScanResult,
};

export interface IndexPayload extends ManifestIndex {
  manifestBytes: number;
  manifestUrl: string;
}

export interface BundlePayload {
  url: string;
  downloadSize: number;
  sha1: string;
  sha384: string;
  digestMatch?: { sha1: boolean; sha384?: boolean };
  info: BundleInfo;
  quick: Record<string, unknown>;
  ref?: BundleRef & { carrier?: string };
}

export interface CarrierPayload {
  summary?: CarrierSummary;
  refs: BundleRef[];
  country: { cc?: string; name?: string };
}

export interface CbsPayload {
  family: string;
  generatedAt: string;
  messageIds: number[];
  rows: CbsRow[];
  note: string;
}

export interface DiffPayload {
  path: string;
  a: string;
  b: string;
  rows: DiffRow[];
  counts: Record<string, number>;
  aFiles: string[];
  bFiles: string[];
}

const store = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

export function cachedGet<T>(url: string): Promise<T> {
  if (store.has(url)) return Promise.resolve(store.get(url) as T);
  const running = inflight.get(url);
  if (running) return running as Promise<T>;
  const p = fetch(url)
    .then(async (r) => {
      const body = await r.json().catch(() => ({ error: "HTTP " + r.status }));
      if (!r.ok) throw new Error((body as { error?: string }).error ?? "HTTP " + r.status);
      return body as T;
    })
    .then((v) => {
      store.set(url, v);
      inflight.delete(url);
      return v;
    })
    .catch((e) => {
      inflight.delete(url);
      throw e;
    });
  inflight.set(url, p);
  return p;
}

const enc = encodeURIComponent;

export const api = {
  index: () => cachedGet<IndexPayload>("/api/index"),
  mccmnc: () =>
    cachedGet<{
      entries: MccMncEntry[];
      carrierIds: Array<[string, string]>;
      iccids: Array<[string, string]>;
    }>("/api/mccmnc"),
  carrier: (name: string) => cachedGet<CarrierPayload>("/api/carrier?name=" + enc(name)),
  bundle: (url: string, carrier?: string) =>
    cachedGet<BundlePayload>("/api/bundle?url=" + enc(url) + (carrier ? "&carrier=" + enc(carrier) : "")),
  file: (url: string, path: string) =>
    cachedGet<DecodedFile & { dataUri?: string }>("/api/file?url=" + enc(url) + "&path=" + enc(path)),
  cbs: (family = "iPhone") => cachedGet<CbsPayload>("/api/cbs?family=" + family),
  countries: () =>
    cachedGet<{ iPhone: CountrySummary[]; Watch: CountrySummary[]; all: CountrySummary[] }>("/api/countries"),
  diff: (a: string, b: string, path: string) =>
    cachedGet<DiffPayload>("/api/diff?a=" + enc(a) + "&b=" + enc(b) + "&path=" + enc(path)),
  keyscan: (path: string, scope: string, file: string, limit: number) =>
    cachedGet<ScanResult>(
      "/api/keyscan?path=" + enc(path) + "&scope=" + enc(scope) + "&file=" + enc(file) + "&limit=" + limit,
    ),
  downloadUrl: (url: string) => "/api/download?url=" + enc(url),
  rawUrl: (url: string, path: string, download = false) =>
    "/api/raw?url=" + enc(url) + "&path=" + enc(path) + (download ? "&dl=1" : ""),
};

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
