/**
 * The firmware catalogues iOS ingest reads: ipsw.me for releases (dates,
 * every iPhone's IPSW links, board configs) and AppleDB for betas, which
 * ipsw.me does not list but AppleDB does, with Apple's own IPSW links. Every
 * response is validated: both are third-party JSON.
 */

import * as v from "valibot";

import { compareProducts } from "../../../../../src/lib/decode/index.ts";
import { fetchWithRetry } from "../../../../../src/lib/http/index.ts";
import { mapLimit } from "./map-limit.ts";

const IPSW_ME = "https://api.ipsw.me/v4";
const APPLEDB = "https://api.appledb.dev/ios/";

/** Shared CDNs: a few requests at a time, as the v1 scripts did. */
const CONCURRENCY = 4;

async function getJson(url: string): Promise<unknown> {
  const res = await fetchWithRetry(url);
  return res.json();
}

/** An ipsw.me firmware entry, with the device it was listed under. */
export interface Firmware {
  readonly version: string;
  readonly build: string;
  readonly device: string;
  readonly url: string;
  /** YYYY-MM-DD; ipsw.me stamps `2026-09-15T17:05:25Z`. */
  readonly released?: string;
}

const DeviceList = v.array(v.looseObject({ identifier: v.string() }));
const DeviceFirmwares = v.looseObject({
  firmwares: v.array(
    v.looseObject({
      version: v.string(),
      buildid: v.string(),
      url: v.string(),
      releasedate: v.nullish(v.string()),
    }),
  ),
  boards: v.optional(v.array(v.looseObject({ boardconfig: v.string() }))),
});

const day = (stamp: string | null | undefined): string | undefined => (stamp ? stamp.slice(0, 10) : undefined);

/** Every iPhone product type ipsw.me knows. */
export async function iphones(): Promise<string[]> {
  const list = v.parse(DeviceList, await getJson(`${IPSW_ME}/devices`));
  return list.map((d) => d.identifier).filter((id) => id.startsWith("iPhone"));
}

export async function newestIphone(): Promise<string> {
  const newest = (await iphones()).sort(compareProducts).at(-1);
  if (!newest) throw new Error("ipsw.me lists no iPhone");
  return newest;
}

export interface DeviceCatalog {
  readonly firmwares: readonly Firmware[];
  /** Board configs, lower-case (`d93ap`): how a BuildManifest names this phone. */
  readonly boards: readonly string[];
}

export async function deviceFirmwares(device: string): Promise<DeviceCatalog> {
  const d = v.parse(DeviceFirmwares, await getJson(`${IPSW_ME}/device/${encodeURIComponent(device)}?type=ipsw`));
  return {
    firmwares: d.firmwares.map((f) => {
      const released = day(f.releasedate);
      return { version: f.version, build: f.buildid, device, url: f.url, ...(released ? { released } : {}) };
    }),
    boards: (d.boards ?? []).map((b) => b.boardconfig.toLowerCase()),
  };
}

export interface IphoneCatalog {
  /** build -> every (device, IPSW URL) ipsw.me lists for it. */
  readonly byBuild: ReadonlyMap<string, ReadonlyArray<{ readonly device: string; readonly url: string }>>;
  /** device -> its board configs. */
  readonly boards: ReadonlyMap<string, readonly string[]>;
}

/** Every iPhone's firmware list: what fills a build's IPSW list and which modem each phone has. */
export async function iphoneCatalog(): Promise<IphoneCatalog> {
  const lists = await mapLimit(await iphones(), CONCURRENCY, async (device) => [device, await deviceFirmwares(device)] as const);
  const byBuild = new Map<string, Array<{ device: string; url: string }>>();
  const boards = new Map<string, readonly string[]>();
  for (const [device, d] of lists) {
    if (d.boards.length) boards.set(device, d.boards);
    for (const f of d.firmwares) {
      const pairs = byBuild.get(f.build) ?? [];
      pairs.push({ device, url: f.url });
      byBuild.set(f.build, pairs);
    }
  }
  return { byBuild, boards };
}

/* ---------------------------------------------------------------- AppleDB */

/** AppleDB's index: `iOS;24B5089g`, `watchOS;...`, `iOS;24B5084k-sim`... */
export async function appledbKeys(): Promise<string[]> {
  return v.parse(v.array(v.string()), await getJson(`${APPLEDB}index.json`));
}

const AppleDbFirmware = v.looseObject({
  version: v.string(),
  build: v.string(),
  beta: v.optional(v.boolean()),
  released: v.optional(v.string()),
  /** device -> { ipsw } or, for aliases, a string naming another device. */
  devices: v.nullish(v.record(v.string(), v.unknown())),
});

export interface AppleDbEntry {
  readonly version: string;
  readonly build: string;
  readonly beta: boolean;
  readonly released?: string;
  /** iPhone -> IPSW URL, only the iPhones with a link. */
  readonly ipsws: ReadonlyMap<string, string>;
}

const IpswLink = v.looseObject({ ipsw: v.string() });

/** device -> IPSW URL among an AppleDB record's devices: iPhones with a link only. */
export function iphoneIpsws(devices: Readonly<Record<string, unknown>> | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const [device, entry] of Object.entries(devices ?? {})) {
    if (device.startsWith("iPhone") && v.is(IpswLink, entry) && entry.ipsw) out.set(device, entry.ipsw);
  }
  return out;
}

export function appledbEntry(raw: unknown): AppleDbEntry {
  const e = v.parse(AppleDbFirmware, raw);
  const released = day(e.released);
  return { version: e.version, build: e.build, beta: e.beta ?? false, ...(released ? { released } : {}), ipsws: iphoneIpsws(e.devices) };
}

export async function appledbFirmware(build: string): Promise<AppleDbEntry> {
  return appledbEntry(await getJson(`${APPLEDB}${encodeURIComponent(`iOS;${build}`)}.json`));
}
