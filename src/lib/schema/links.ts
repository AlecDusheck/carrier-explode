/**
 * Hand-kept corrections to SIM linking (./identity.ts), for what the SIM rules
 * cannot say. Every entry names why.
 *
 * - `link`: sources that are one carrier although no SIM rule is shared exactly
 *   (the platforms key the same SIMs differently: iOS a GID2, Android a GID1).
 * - `split`: sources a shared rule would join that are different carriers.
 * - `names`: the display name for the carrier holding a source, where neither
 *   platform's name reads well.
 */

export interface Links {
  readonly link: ReadonlyArray<readonly [string, string, string]>;
  readonly split: ReadonlyArray<readonly [string, string, string]>;
  readonly names: Readonly<Record<string, string>>;
}

const ios = (name: string): string => `ios:carrier:${name}`;
const android = (name: string): string => `android:carrier:${name}`;

export const LINKS: Links = {
  link: [
    // One carrier, several SIM profiles: each profile gets its own bundle or canonical.
    [ios("ATT_US"), ios("ATT_NR_US"), "AT&T's 5G SIMs (GID1 52/53) get their own iOS bundle"],
    [ios("ATT_aio_US"), ios("ATT_aio_NR_US"), "Cricket's 5G SIMs get their own iOS bundle"],
    [ios("KDDI_jp"), ios("KDDI_NR_jp"), "au's 5G network codes, split across two iOS bundles"],
    [ios("KDDI_LTE_jp"), ios("KDDI_NR_jp"), "au's LTE and 5G iOS bundles"],
    [ios("Verizon_Visible_LTE_US"), ios("Verizon_Core_Visible_LTE_US"), "Visible on Verizon's 5G core (GID2 1C) is still Visible"],
    // Same SIMs, keyed differently: iOS by GID2 or a short GID1, Android by a longer GID1 or SPN.
    [ios("Verizon_Visible_LTE_US"), android("visible_us"), "iOS keys Visible by GID2 1A, Android by GID1 BAE1"],
    [ios("Verizon_Comcast_LTE_US"), android("xfinity_us"), "Xfinity Mobile: iOS GID2 A3, Android GID1 BA0145"],
    [android("xfinity_us"), android("xfinity2_us"), "both Android Xfinity Mobile profiles (GID1 BA0145, BA0164)"],
    [ios("Verizon_Charter_LTE_US"), android("spectrum_us"), "Spectrum Mobile: iOS GID2 A7, Android GID1 BA0149"],
    [ios("Verizon_Cox_LTE_US"), android("cox_us"), "Cox Mobile: iOS GID2 B1, Android by its own PLMN"],
    [ios("Verizon_TFW_LTE_US"), android("tracfoneverizon_us"), "Tracfone on Verizon: iOS GID2 A1"],
    [ios("TMobile_MetroPCS_US"), android("metropcs_us"), "Metro by T-Mobile: iOS GID1 6D, Android GID1 6D38"],
    [ios("O2_Giffgaff_UK"), android("giffgaff_gb"), "giffgaff: iOS GID1 508F, Android GID1 50 or SPN"],
    [ios("O2_Sky_uk"), android("sky_gb"), "Sky Mobile on O2"],
    [ios("Telus_ca"), android("telus_ca"), "Android keys Telus by GID1 5455, iOS by plain network code"],
    [ios("Telus_Koodo_ca"), android("koodo_ca"), "Koodo: Android GID1 4B4F"],
    [ios("Telus_PublicMobile_ca"), android("publicmobile_ca"), "Public Mobile on Telus"],
    [ios("Vodafone_Lowi_es"), android("lowi_es"), "Lowi on Vodafone Spain"],
  ],
  split: [
    // 310470 is listed by both; Docomo Pacific and nTelos are different carriers.
    [ios("nTelos_LTE_US"), android("docomopacific_us"), "nTelos (Virginia) is not Docomo Pacific (Guam)"],
    // KDDI's MVNO profile shares au's 5G SA network code; it is the MVNOs, not au.
    [ios("KDDI_jp"), android("kddimvno5gsa_jp"), "KDDI MVNOs on 5G SA are not au"],
    [ios("KDDI_NR_jp"), android("kddimvno5gsa_jp"), "KDDI MVNOs on 5G SA are not au"],
  ],
  names: {
    // Brands the bundle names hide behind their host (Verizon_Comcast_LTE_US) or an old name (Orange_uk).
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
