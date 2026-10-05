/** What the index calls each code, and when each device was released: a label where its origin outranks the data, else the data. */

import { iosModemName } from "./ios/modem-names.ts";
import { labelsOf, resolved, type Label } from "./labels.ts";
import type { Device, ModemVendor, Name, Named, Release } from "./types.ts";

/** The Android vendors whose configs the decoders read. */
const VENDOR_NAMES = { qualcomm: "Qualcomm", shannon: "Samsung Shannon", mediatek: "MediaTek" } as const satisfies Record<ModemVendor, string>;

export interface Naming {
  /** The feeds' records, each released when a label says so where it outranks the feed. */
  readonly devices: readonly Device[];
  readonly device: (code: string) => Named;
  /** A carrier's name: its label's, else the data's. `own` is false when the data's is only one of its sources' names standing in. */
  readonly carrier: (id: string, derived: string, own: boolean) => string;
  readonly vendor: (vendor: ModemVendor) => Named<ModemVendor>;
  /** A release's modem families, each once, as its modems list them. */
  readonly modems: (release: Release) => Named[];
  /** Every device a label names, and every modem family the releases ship. */
  readonly names: (releases: readonly Release[]) => Name[];
}

const unique = <N extends Named>(named: readonly N[]): N[] => [...new Map(named.map((n) => [n.code, n])).values()];

export function naming(labels: readonly Label[], records: readonly Device[]): Naming {
  const deviceNames = labelsOf(labels, "device", "name");
  const released = labelsOf(labels, "device", "released");
  const carrierNames = labelsOf(labels, "carrier", "name");
  const modemNames = labelsOf(labels, "modem", "name");
  // No data names a modem: a label, else what its code implies.
  const modemLabel = (code: string): string | undefined => resolved(modemNames.get(code), undefined);

  const device = (code: string): Named => ({ code, name: resolved(deviceNames.get(code), undefined) ?? code });
  const vendor = (code: ModemVendor): Named<ModemVendor> => ({ code, name: modemLabel(code) ?? VENDOR_NAMES[code] });
  const modems = (r: Release): Named[] => unique(r.platform === "android"
    ? r.modems.map((m) => vendor(m.family))
    : r.modems.map((m): Named => ({ code: m.family, name: iosModemName(m.family, modemLabel(m.family)) })));

  return {
    devices: records.map((d) => ({ ...d, released: resolved(released.get(d.code), d.released) ?? d.released })),
    device,
    carrier: (id, derived, own) => resolved(carrierNames.get(id), own ? derived : undefined) ?? derived,
    vendor,
    modems,
    names: (releases) => [
      ...[...deviceNames.keys()].sort().map((code): Name => ({ subject: "device", ...device(code) })),
      ...unique(releases.flatMap(modems)).sort((a, b) => a.code.localeCompare(b.code)).map((m): Name => ({ subject: "modem", ...m })),
    ],
  };
}
