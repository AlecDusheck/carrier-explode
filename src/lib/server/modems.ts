/** Modem packages: where their summaries are stored, and an image's package as the pages show it. */

import { MODEM_SUMMARY_SCHEMA, modemVendor, productName, type ModemVendor } from "#lib/decode/index.ts";
import { keys } from "#lib/storage/keys.ts";
import type { ImageModem, ModemKind } from "#lib/schema/types.ts";

/** R2 key of package `id`'s decoded summary, written by the extractor's ios.modems job. */
export const summaryKey = (id: string): string => keys.decoded("baseband", MODEM_SUMMARY_SCHEMA, id);

export interface ModemView {
  readonly family: string;
  readonly vendor: ModemVendor | undefined;
  readonly package: { readonly id: string; readonly name: string; readonly size: number; readonly kind: ModemKind };
  readonly devices: ReadonlyArray<{ readonly id: string; readonly name: string | undefined }>;
}

export const modemView = (m: ImageModem): ModemView => ({
  family: m.family,
  vendor: modemVendor(m.family),
  package: { id: m.package.sha, name: m.package.name, size: m.package.size, kind: m.package.kind },
  devices: m.devices.map((id) => ({ id, name: productName(id) })),
});
