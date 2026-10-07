/** How a modem family a release ships reads to a person, from the label someone gave it. */

import { iosModemName } from "./ios/modem-names.ts";
import type { ReleasePlatform } from "./types.ts";

/** An iOS generation reads with its vendor and code; an Android vendor by its label alone. */
const FAMILY_NAMES = {
	ios: iosModemName,
	android: (family, label) => label ?? family,
	samsung: (family, label) => label ?? family,
} as const satisfies Record<ReleasePlatform, (family: string, label: string | null) => string>;

/** Qualcomm's MPSS build id names the chipset it was built for: `MPSS.DE.9.0-01972.5-KAANAPALI_GEN_PACK-1.129782.405`. */
const MPSS_CHIP = /^MPSS\.[^-]+-[^-]+-([A-Z0-9]+)_GEN_PACK-/;

/** A Pixel's or Galaxy's modem firmware's family: the chipset its name gives, as labels name chips, else its vendor. */
export const firmwareFamily = (vendor: string, firmware: string): string =>
	MPSS_CHIP.exec(firmware)?.[1] ?? vendor;

export const modemFamilyName = (platform: ReleasePlatform, family: string, label: string | null): string =>
	FAMILY_NAMES[platform](family, label);
