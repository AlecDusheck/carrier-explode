/** Android modem configurations as the pages read them: a carrier's, a build's firmware and its own configurations, and their band combinations. */

import { error } from "@sveltejs/kit";
import * as v from "valibot";
import { sha256Hex } from "@carrier-explode/binary";
import { keys } from "@carrier-explode/storage";
import { bandCombinationsSchema, modemConfigSchema } from "@carrier-explode/schema/records";
import { MODEM_SCOPES, PROFILE_SCHEMA, type AndroidModem, type BandCombination, type CarrierModem, type ModemConfig } from "@carrier-explode/schema/types";
import { deviceModems } from "@carrier-explode/schema";
import type { BuildModem } from "../builds";
import type { Ver } from "#lib/types.ts";
import { cached, perRequest } from "../cache";
import { releaseList, resolve } from "../catalog";
import { namer } from "../names";
import { mustRelease } from "../releases";
import { readJson } from "../store";

const modemConfigOf = perRequest((sha: string) => readJson(keys.norm(sha), modemConfigSchema));

async function mustConfig(sha: string): Promise<ModemConfig> {
  const config = await modemConfigOf(sha);
  if (!config) error(404, `${keys.norm(sha)} is not in the bucket.`);
  return config;
}

export interface ShownModem {
  readonly modem: CarrierModem;
  readonly config: ModemConfig;
  /** Its firmware's page, as getBuildModems names it: the newest Pixel running the firmware. */
  readonly firmware: string;
}

/** The modem configurations the carrier's SIMs select on the version's device, from the newest release that has them; none on a Pixel without. */
export async function getAndroidModems(v: Ver): Promise<readonly ShownModem[]> {
  const r = await resolve(v);
  if (r.ref.platform !== "android") error(400, `${v.source} is not an Android source.`);
  const device = r.line;
  if (device === null) return [];
  return Promise.all(deviceModems(r.modems, device).map(async (modem): Promise<ShownModem> =>
    ({ modem, config: await mustConfig(modem.sha), firmware: modem.devices[0] ?? device })));
}

async function buildGroups(build: string): Promise<Array<{ readonly modem: BuildModem; readonly group: AndroidModem }>> {
  const [release, summary] = await Promise.all([mustRelease("android", build), releaseList()]);
  // The index lists a build's devices newest first.
  const newest = summary.find((r) => r.platform === "android" && r.id === build)?.devices ?? [];
  const rank = (device: string): number => newest.indexOf(device);
  const [device, vendor] = await Promise.all([namer("device", newest), namer("modem", release.modems.map((m) => m.family))]);
  return release.modems
    .map((group) => {
      const devices = group.devices.toSorted((a, b) => rank(a) - rank(b)).map(device);
      const id = devices[0]?.code;
      if (id === undefined) error(500, `${build}: a ${group.family} modem serves no device.`);
      return { modem: { id, label: vendor(group.family).name, firmware: group.firmware, devices }, group };
    })
    .sort((a, b) => rank(a.modem.id) - rank(b.modem.id));
}

/** An Android build's modem firmwares, each named by the newest Pixel running it, newest first. */
export async function buildModems(build: string): Promise<BuildModem[]> {
  return (await buildGroups(build)).map((g) => g.modem);
}

/** A configuration the firmware loads whatever the carrier: a base its carrier configurations are built on, or one no SIM rule ties to a carrier. */
export interface FirmwareConfig {
  readonly label: string;
  readonly sha: string;
  readonly kind: "base" | "default";
}

/** What a firmware page reads of each config: its scope and base, not its items. */
const scopeSchema = v.object({ label: v.string(), scope: v.picklist(MODEM_SCOPES), base: v.nullable(v.string()) });
const READ_AT_ONCE = 6;

/** The firmware's own configurations: every config's base, then the configs of scope "firmware". */
async function firmwareConfigs(group: AndroidModem): Promise<FirmwareConfig[]> {
  const shas = [...new Set(Object.values(group.configs))].sort();
  const key = await sha256Hex(new TextEncoder().encode(shas.join("\n")));
  return cached(`firmware-configs:v${PROFILE_SCHEMA}:${key}`, async () => {
    const heads: Array<v.InferOutput<typeof scopeSchema> & { readonly sha: string }> = [];
    for (let i = 0; i < shas.length; i += READ_AT_ONCE) {
      heads.push(...(await Promise.all(shas.slice(i, i + READ_AT_ONCE).map(async (sha) => {
        const head = await readJson(keys.norm(sha), scopeSchema);
        if (!head) error(500, `${keys.norm(sha)} is not in the bucket.`);
        return { ...head, sha };
      }))));
    }
    const bases = await Promise.all([...new Set(heads.flatMap((h) => h.base ?? []))].map(async (sha): Promise<FirmwareConfig> => ({ label: (await mustConfig(sha)).label, sha, kind: "base" })));
    const defaults = heads.filter((h) => h.scope === "firmware").map((h): FirmwareConfig => ({ label: h.label, sha: h.sha, kind: "default" }));
    return [...bases, ...defaults.sort((a, b) => a.label.localeCompare(b.label))];
  });
}

export interface ModemFirmware {
  readonly modem: BuildModem;
  readonly configs: readonly FirmwareConfig[];
}

/** The firmware a Pixel runs in a build, and its own configurations; null when the build has none for it. */
export async function getModemFirmware(build: string, device: string): Promise<ModemFirmware | null> {
  const g = (await buildGroups(build)).find((x) => x.group.devices.includes(device));
  return g ? { modem: g.modem, configs: await firmwareConfigs(g.group) } : null;
}

/** One stored modem configuration, decoded. */
export const getModemConfigBySha = mustConfig;

/** One stored list of band combinations. */
export async function getModemCombos(key: string): Promise<readonly BandCombination[]> {
  const list = await readJson(keys.combos(key), bandCombinationsSchema);
  if (!list) error(404, `${keys.combos(key)} is not in the bucket.`);
  return list;
}
