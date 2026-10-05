/** Which Android modem configurations a carrier's SIMs select, and which Pixels they configure for 5G. */

import type { DeviceOrder } from "./devices.ts";
import { configRadio, type ConfigRadio } from "./modem/index.ts";
import type { RadioEvidence } from "./radio.ts";
import { compareReleases } from "./timeline.ts";
import {
  matcherKey, type AndroidModem, type AndroidRelease, type CarrierModem, type ModemConfig, type ModemVendor, type Named, type Release, type SimMatcher,
} from "./types.ts";

/** What the index reads of a ModemConfig: which SIMs select it, whether it configures 5G, and the base layers it is built on. */
export type IndexModemConfig = Pick<ModemConfig, "sha" | "selection" | "base"> & { readonly radio: ConfigRadio };

export const indexModemConfig = (c: ModemConfig): IndexModemConfig => ({ sha: c.sha, selection: c.selection, base: c.base, radio: configRadio(c) });

interface Group {
  readonly release: AndroidRelease;
  readonly modem: AndroidModem;
  readonly devices: readonly string[];
  readonly configs: readonly (readonly [label: string, config: IndexModemConfig])[];
}

/** Each device's newest release that carries modem configs; devices that share it and its firmware form one group. */
function newestModems(releases: readonly Release[]): Array<Omit<Group, "configs">> {
  const android = releases.flatMap((r) => (r.platform === "android" ? [r] : [])).sort((a, b) => compareReleases(b, a));
  const covered = new Set<string>();
  return android.flatMap((release) => release.modems.flatMap((modem) => {
    const devices = modem.devices.filter((d) => !covered.has(d));
    for (const d of devices) covered.add(d);
    return devices.length === 0 ? [] : [{ release, modem, devices }];
  }));
}

/** The configs carrierModems reads, so a caller loads those and not every release's. */
export const linkedConfigShas = (releases: readonly Release[]): string[] =>
  [...new Set(newestModems(releases).flatMap((g) => Object.values(g.modem.configs)))];

function newestGroups(releases: readonly Release[], configOf: (sha: string) => IndexModemConfig | undefined): Group[] {
  return newestModems(releases).map((g) => ({
    ...g,
    configs: Object.entries(g.modem.configs).flatMap(([label, sha]) => {
      const config = configOf(sha);
      return config === undefined ? [] : [[label, config] as const];
    }),
  }));
}

/** A rule with no qualifier: the whole MCC-MNC. */
const isPlmnWide = (m: SimMatcher): boolean => matcherKey(m) === m.mccmnc;

/**
 * Per group, the configs whose selection shares a SIM rule with the carrier; failing any, those selected by
 * the whole of one of the carrier's MCC-MNCs. A config no SIM selects (Default) is never attached.
 */
export function carrierModems(
  releases: readonly Release[], configOf: (sha: string) => IndexModemConfig | undefined, vendor: (v: ModemVendor) => Named<ModemVendor>, order: DeviceOrder,
): (sims: readonly SimMatcher[]) => CarrierModem[] {
  const groups = newestGroups(releases, configOf);
  return (sims) => {
    const keys = new Set(sims.map(matcherKey));
    const plmns = new Set(sims.map((m) => m.mccmnc));
    return groups.flatMap((g) => {
      const exact = g.configs.filter(([, c]) => c.selection.some((m) => keys.has(matcherKey(m))));
      const chosen = exact.length > 0 ? exact : g.configs.filter(([, c]) => c.selection.some((m) => isPlmnWide(m) && plmns.has(m.mccmnc)));
      return chosen.map(([label, c]): CarrierModem => ({
        family: vendor(g.modem.family), release: g.release.id, firmware: g.modem.firmware, devices: g.devices.toSorted(order), label, sha: c.sha,
      }));
    });
  };
}

/** Each Pixel by its newest modem configurations: configured when its family names their items, for 5G when one is. */
export function modemRadios(releases: readonly Release[], configOf: (sha: string) => IndexModemConfig | undefined): RadioEvidence {
  const configured = new Set<string>(), fiveG = new Set<string>();
  for (const g of newestGroups(releases, configOf)) {
    // A config's base layers configure the modem as much as its own do.
    const radio = (c: IndexModemConfig): ConfigRadio => (c.base !== null && configOf(c.base)?.radio === "nr" ? "nr" : c.radio);
    const read = g.configs.map(([, c]) => radio(c)).filter((r) => r !== "unread");
    if (read.length === 0) continue;
    for (const d of g.devices) configured.add(d);
    if (read.includes("nr")) for (const d of g.devices) fiveG.add(d);
  }
  return { configured, fiveG };
}

/** The carrier's modem configurations a device carries; none without a device (Apple's lines). */
export const deviceModems = (modems: readonly CarrierModem[], device: string | null): CarrierModem[] =>
  device === null ? [] : modems.filter((m) => m.devices.includes(device));
