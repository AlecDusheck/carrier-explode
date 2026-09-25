/** An image's modem package as the pages show it. */

import { modemVendor, productName } from "$lib/decode";
import type { ImageModem } from "./timeline";

export const modemView = (m: ImageModem) => ({
  family: m.family,
  vendor: modemVendor(m.family),
  package: { id: m.package.id, name: m.package.name, size: m.package.size, kind: m.package.kind },
  devices: m.devices.map((id) => ({ id, name: productName(id) })),
});
export type ModemView = ReturnType<typeof modemView>;
