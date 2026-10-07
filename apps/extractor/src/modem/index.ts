/** A Pixel's modem carrier configurations, one archive each (ModemArchive), by the modem family its images hold. */

import type { Filesystem } from "@carrier-explode/firmware";
import { listed, ModemExtractError, tensorLabel, type ExtractedModem } from "./archive.ts";
import { mediatekModem } from "./mediatek.ts";
import { qualcommModem } from "./qualcomm.ts";
import { MODEM_BINS, shannonModem, type ShannonItems } from "./shannon.ts";

export type { ExtractedModem, ModemArchive } from "./archive.ts";
export { MODEM_PATHS, qualcommModem } from "./qualcomm.ts";
export { shannonItems, shannonItemsSchema, type ShannonItems } from "./shannon.ts";

/** A modem image's family; a Tensor's with the build directory images/default links to. */
export type ModemFamily =
	| { readonly family: "qualcomm" }
	| { readonly family: "mediatek" | "shannon"; readonly label: string };

/** Qualcomm's NON-HLOS is FAT; a Tensor modem image holds images/<label>/ with MediaTek's mcf/ or Shannon's modem.bin(.gz). */
export async function modemFamily(modem: Filesystem): Promise<ModemFamily> {
	if (modem.kind === "fat") return { family: "qualcomm" };
	const label = await tensorLabel(modem);
	if (await listed(modem, `images/${label}/mcf`)) return { family: "mediatek", label };
	if ((await listed(modem, `images/${label}`))?.some((e) => MODEM_BINS.has(e.name)))
		return { family: "shannon", label };
	throw new ModemExtractError(`modem/images/${label} holds neither mcf/ nor modem.bin(.gz)`);
}

/** A device's partitions, each opened only when its family's reader needs it. */
export interface DeviceImages {
	readonly modem: () => Promise<Filesystem>;
	readonly vendor: () => Promise<Filesystem>;
}

/** The family's configurations. Shannon's read no modem image: their item table (`items`) was streamed from it in a step of its own. */
export async function familyModem(
	family: ModemFamily,
	images: DeviceImages,
	items: () => Promise<ShannonItems>,
): Promise<ExtractedModem> {
	switch (family.family) {
		case "qualcomm":
			return qualcommModem({ modem: await images.modem(), vendor: images.vendor });
		case "mediatek":
			return mediatekModem({ modem: await images.modem(), vendor: images.vendor });
		case "shannon":
			return shannonModem(await images.vendor(), family.label, items);
	}
}
