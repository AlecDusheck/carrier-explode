/** Modem packages: where their summaries are stored, and an image's package as the pages show it. */

import { MODEM_SUMMARY_SCHEMA, modemVendor, productName } from "$lib/decode";
import type { ImageModem } from "./timeline";

/** R2 key of package `id`'s decoded summary. Written by scripts/baseband.ts, read by the worker. */
export const summaryKey = (id: string) => `baseband/v${MODEM_SUMMARY_SCHEMA}/${id}.json`;

export const modemView = (m: ImageModem) => ({
  family: m.family,
  vendor: modemVendor(m.family),
  package: { id: m.package.id, name: m.package.name, size: m.package.size, kind: m.package.kind },
  devices: m.devices.map((id) => ({ id, name: productName(id) })),
});
export type ModemView = ReturnType<typeof modemView>;
