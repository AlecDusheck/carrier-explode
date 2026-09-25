/** Which of an image's modem packages a page means. */

import { modemVendor, productName, type ModemKind } from "$lib/decode";
import type { ImageModem } from "./timeline";

export const modemView = (m: ImageModem) => ({
  family: m.family,
  vendor: modemVendor(m.family),
  package: { id: m.package.id, name: m.package.name, size: m.package.size, kind: m.package.kind },
  devices: m.devices.map((id) => ({ id, name: productName(id) })),
});
export type ModemView = ReturnType<typeof modemView>;

/**
 * `family` when named; otherwise the package serving `device`, then the first
 * Qualcomm one, then the first. `kind` narrows the choice to packages of that kind.
 */
export function pickModem(modems: ImageModem[], o: { family?: string; device?: string; kind?: ModemKind } = {}) {
  const pool = o.kind ? modems.filter((m) => m.package.kind === o.kind) : modems;
  if (o.family) return pool.find((m) => m.family === o.family);
  return (o.device ? pool.find((m) => m.devices.includes(o.device!)) : undefined)
    ?? pool.find((m) => modemVendor(m.family) === "qualcomm")
    ?? pool[0];
}
