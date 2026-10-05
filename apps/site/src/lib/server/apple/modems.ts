/** Modem packages: where their summaries are stored, and an image's package as the pages show it. */

import { byNewest, MODEM_SUMMARY_SCHEMA } from "@carrier-explode/decode-ios";
import { keys } from "@carrier-explode/storage";
import type { ImageModem, ModemPackage, Named } from "@carrier-explode/schema/types";
import type { BuildModem } from "../builds";
import { namer } from "../names";
import { releaseModems } from "../releases";

/** R2 key of package `id`'s decoded summary, written by the extractor's ios.modems job. */
export const summaryKey = (id: string): string => keys.modemSummary(MODEM_SUMMARY_SCHEMA, id);

export interface ModemView {
  /** The package's generation: `Mav25`, `C1`. */
  readonly family: Named;
  readonly package: Pick<ModemPackage, "name" | "size" | "kind"> & { readonly id: string };
  readonly devices: readonly Named[];
}

/** Each package as the pages show it, its generation and phones named. */
export async function modemViews(modems: readonly ImageModem[]): Promise<ModemView[]> {
  const [family, phone] = await Promise.all([namer("modem", modems.map((m) => m.family)), namer("device", modems.flatMap((m) => m.devices))]);
  return modems.map((m) => ({
    family: family(m.family),
    package: { id: m.package.sha, name: m.package.name, size: m.package.size, kind: m.package.kind },
    devices: m.devices.map(phone),
  }));
}

/** An iOS build's modem packages, one per generation, newest phones first. */
export async function buildModems(build: string): Promise<BuildModem[]> {
  const { modems } = await releaseModems(build);
  return byNewest(await modemViews(modems)).map((v) => ({ id: v.family.code, label: v.family.name, firmware: v.package.name, devices: v.devices }));
}
