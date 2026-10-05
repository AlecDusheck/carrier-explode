/** Hand-kept corrections to SIM linking: `link` joins sources keyed differently, `split` keeps two carriers apart, `names` renames a carrier. A split naming an Apple bundle covers its iPad and Watch files too. */

import { sourceKey, type SourceKey } from "./types.ts";

/** Two sources and why the rule holds. */
interface LinkRule {
  readonly a: SourceKey;
  readonly b: SourceKey;
  readonly why: string;
}

export interface Links {
  readonly link: readonly LinkRule[];
  readonly split: readonly LinkRule[];
  readonly names: Readonly<Partial<Record<SourceKey, string>>>;
}

const ios = (name: string): SourceKey => sourceKey({ platform: "ios", kind: "carrier", name });
const android = (name: string): SourceKey => sourceKey({ platform: "android", kind: "carrier", name });

export const LINKS: Links = {
  link: [
    // One carrier, several SIM profiles: each profile gets its own bundle or canonical.
    { a: ios("ATT_US"), b: ios("ATT_NR_US"), why: "AT&T's 5G SIMs (GID1 52/53) get their own iOS bundle" },
    { a: ios("ATT_aio_US"), b: ios("ATT_aio_NR_US"), why: "Cricket's 5G SIMs get their own iOS bundle" },
    { a: ios("KDDI_jp"), b: ios("KDDI_NR_jp"), why: "au's 5G network codes, split across two iOS bundles" },
    { a: ios("KDDI_LTE_jp"), b: ios("KDDI_NR_jp"), why: "au's LTE and 5G iOS bundles" },
    { a: ios("Verizon_Visible_LTE_US"), b: ios("Verizon_Core_Visible_LTE_US"), why: "Visible on Verizon's 5G core (GID2 1C) is still Visible" },
    // Same SIMs, keyed differently: iOS by GID2 or a short GID1, Android by a longer GID1 or SPN.
    { a: ios("Verizon_Visible_LTE_US"), b: android("visible_us"), why: "iOS keys Visible by GID2 1A, Android by GID1 BAE1" },
    { a: ios("Verizon_Comcast_LTE_US"), b: android("xfinity_us"), why: "Xfinity Mobile: iOS GID2 A3, Android GID1 BA0145" },
    { a: android("xfinity_us"), b: android("xfinity2_us"), why: "both Android Xfinity Mobile profiles (GID1 BA0145, BA0164)" },
    { a: ios("Verizon_Charter_LTE_US"), b: android("spectrum_us"), why: "Spectrum Mobile: iOS GID2 A7, Android GID1 BA0149" },
    { a: ios("Verizon_Cox_LTE_US"), b: android("cox_us"), why: "Cox Mobile: iOS GID2 B1, Android by its own PLMN" },
    { a: ios("Verizon_TFW_LTE_US"), b: android("tracfoneverizon_us"), why: "Tracfone on Verizon: iOS GID2 A1" },
    { a: ios("TMobile_MetroPCS_US"), b: android("metropcs_us"), why: "Metro by T-Mobile: iOS GID1 6D, Android GID1 6D38" },
    { a: ios("O2_Giffgaff_UK"), b: android("giffgaff_gb"), why: "giffgaff: iOS GID1 508F, Android GID1 50 or SPN" },
    { a: ios("O2_Sky_uk"), b: android("sky_gb"), why: "Sky Mobile on O2" },
    { a: ios("Telus_ca"), b: android("telus_ca"), why: "Android keys Telus by GID1 5455, iOS by plain network code" },
    { a: ios("Telus_Koodo_ca"), b: android("koodo_ca"), why: "Koodo: Android GID1 4B4F" },
    { a: ios("Telus_PublicMobile_ca"), b: android("publicmobile_ca"), why: "Public Mobile on Telus" },
    { a: ios("Vodafone_Lowi_es"), b: android("lowi_es"), why: "Lowi on Vodafone Spain" },
  ],
  split: [
    { a: ios("nTelos_LTE_US"), b: android("docomopacific_us"), why: "both list 310470, but nTelos (Virginia) is not Docomo Pacific (Guam)" },
    { a: ios("KDDI_jp"), b: android("kddimvno5gsa_jp"), why: "KDDI's MVNOs share au's 5G SA network code, but are not au" },
    { a: ios("KDDI_NR_jp"), b: android("kddimvno5gsa_jp"), why: "KDDI's MVNOs share au's 5G SA network code, but are not au" },
  ],
  names: {
    // Brands a source name hides behind a host (Verizon_Comcast_LTE_US) or a former name (tmobile_nl is Odido).
    [android("ee_gb")]: "EE",
    [android("tmobile_nl")]: "Odido",
    [ios("Verizon_Visible_LTE_US")]: "Visible",
    [ios("Verizon_Comcast_LTE_US")]: "Xfinity Mobile",
    [ios("Verizon_Charter_LTE_US")]: "Spectrum Mobile",
    [ios("Verizon_Cox_LTE_US")]: "Cox Mobile",
    [ios("O2_Giffgaff_UK")]: "giffgaff",
    [ios("Telus_Koodo_ca")]: "Koodo",
    [ios("Telus_PublicMobile_ca")]: "Public Mobile",
    [ios("TMobile_UltraMint_US")]: "Mint Mobile and Ultra Mobile",
  },
};
