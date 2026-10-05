/** Firmware catalogues: ipsw.me for releases and board configs, AppleDB for the betas ipsw.me does not list and every device's boards and release day. */

import * as v from "valibot";

import { newestProduct } from "@carrier-explode/decode-ios";
import { fetchWithRetry } from "@carrier-explode/http";
import type { ListedDevice } from "@carrier-explode/db";
import type { Label } from "@carrier-explode/schema/records";
import { allOrThrow, fanOut } from "../../fan-out.ts";
import { APPLEDB_DEVICES, appleDbDevicesSchema, appleDeviceRecords } from "./devices.ts";

const IPSW_ME = "https://api.ipsw.me/v4";
const APPLEDB = "https://api.appledb.dev/ios/";

/** Community-run APIs (ipsw.me, AppleDB): a few requests at a time. */
export const CATALOG_CONCURRENCY = 4;

async function getJson<S extends v.GenericSchema>(url: string, schema: S): Promise<v.InferOutput<S>> {
  const body: unknown = await (await fetchWithRetry(url)).json();
  return v.parse(schema, body);
}

/** YYYY-MM-DD; ipsw.me stamps `2026-09-15T17:05:25Z`. */
const day = (stamp: string | null | undefined): { released?: string } => (stamp ? { released: stamp.slice(0, 10) } : {});

/** An ipsw.me firmware entry, with the device it was listed under. */
export interface Firmware {
  readonly version: string;
  readonly build: string;
  readonly device: string;
  readonly url: string;
  readonly released?: string;
}

const DEVICES = `${IPSW_ME}/devices`;
const DeviceList = v.array(v.looseObject({ identifier: v.string(), name: v.string() }));
const DeviceFirmwares = v.looseObject({
  firmwares: v.array(v.looseObject({ version: v.string(), buildid: v.string(), url: v.string(), releasedate: v.nullish(v.string()) })),
  boards: v.optional(v.array(v.looseObject({ boardconfig: v.string() })), []),
});

/** Every device ipsw.me knows (iPhone, iPad, Watch and more), with the name Apple sells it as. */
export const appleDevices = async (): Promise<{ readonly evidence: string; readonly names: ReadonlyArray<Pick<Label, "code" | "value">> }> =>
  ({ evidence: DEVICES, names: (await getJson(DEVICES, DeviceList)).map((d) => ({ code: d.identifier, value: d.name })) });

/** Every Apple device AppleDB records with a board and a release day; ipsw.me lists no Watch it has no IPSW for. */
export const appleDbDevices = async (): Promise<ListedDevice[]> =>
  appleDeviceRecords(await getJson(APPLEDB_DEVICES, appleDbDevicesSchema)).map((d) => ({ ...d, evidence: APPLEDB_DEVICES }));

/** Every iPhone product type ipsw.me knows. */
async function iphones(): Promise<string[]> {
  return (await appleDevices()).names.map((d) => d.code).filter((id) => id.startsWith("iPhone"));
}

export async function newestIphone(): Promise<string> {
  const newest = newestProduct(await iphones());
  if (!newest) throw new Error("ipsw.me lists no iPhone");
  return newest;
}

export interface DeviceCatalog {
  readonly firmwares: readonly Firmware[];
  /** Board configs, lower-case (`d93ap`): how a BuildManifest names this phone. */
  readonly boards: readonly string[];
}

export async function deviceFirmwares(device: string): Promise<DeviceCatalog> {
  const d = await getJson(`${IPSW_ME}/device/${encodeURIComponent(device)}?type=ipsw`, DeviceFirmwares);
  return {
    firmwares: d.firmwares.map((f) => ({ version: f.version, build: f.buildid, device, url: f.url, ...day(f.releasedate) })),
    boards: d.boards.map((b) => b.boardconfig.toLowerCase()),
  };
}

export interface IpswRef {
  readonly device: string;
  readonly url: string;
}

export interface IphoneCatalog {
  /** build -> every (device, IPSW URL) ipsw.me lists for it. */
  readonly byBuild: ReadonlyMap<string, readonly IpswRef[]>;
  /** device -> its board configs. */
  readonly boards: ReadonlyMap<string, readonly string[]>;
}

/** Every iPhone's firmware list: what fills a build's IPSW list and which modem each phone has. */
export async function iphoneCatalog(): Promise<IphoneCatalog> {
  const lists = allOrThrow("ipsw.me devices", await fanOut(await iphones(), CATALOG_CONCURRENCY, async (device) => [device, await deviceFirmwares(device)] as const));
  const byBuild = new Map<string, IpswRef[]>();
  const boards = new Map<string, readonly string[]>();
  for (const [device, d] of lists) {
    if (d.boards.length) boards.set(device, d.boards);
    for (const f of d.firmwares) byBuild.set(f.build, [...(byBuild.get(f.build) ?? []), { device, url: f.url }]);
  }
  return { byBuild, boards };
}

/** AppleDB's index: `iOS;24B5089g`, `watchOS;...`, `iOS;24B5084k-sim`... */
export async function appledbKeys(): Promise<string[]> {
  return getJson(`${APPLEDB}index.json`, v.array(v.string()));
}

export interface AppleDbEntry {
  readonly version: string;
  readonly build: string;
  readonly beta: boolean;
  readonly released?: string;
  /** iPhone -> IPSW URL, only the iPhones with a link. */
  readonly ipsws: ReadonlyMap<string, string>;
}

const AppleDbFirmware = v.looseObject({
  version: v.string(),
  build: v.string(),
  beta: v.optional(v.boolean(), false),
  released: v.optional(v.string()),
  /** device -> { ipsw }, or for an alias a string naming another device. */
  devices: v.optional(v.record(v.string(), v.unknown()), {}),
});

const IpswLink = v.looseObject({ ipsw: v.pipe(v.string(), v.minLength(1)) });

export function appledbEntry(raw: unknown): AppleDbEntry {
  const e = v.parse(AppleDbFirmware, raw);
  const ipsws = new Map<string, string>();
  for (const [device, entry] of Object.entries(e.devices)) {
    if (device.startsWith("iPhone") && v.is(IpswLink, entry)) ipsws.set(device, entry.ipsw);
  }
  return { version: e.version, build: e.build, beta: e.beta, ...day(e.released), ipsws };
}

export async function appledbFirmware(build: string): Promise<AppleDbEntry> {
  return appledbEntry(await getJson(`${APPLEDB}${encodeURIComponent(`iOS;${build}`)}.json`, v.unknown()));
}
