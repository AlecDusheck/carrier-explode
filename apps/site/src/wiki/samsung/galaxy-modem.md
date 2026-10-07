---
title: Galaxy modem configuration
searchTitle: "Galaxy modem configs: Qualcomm MCFG in the CP image"
description: "The Qualcomm MCFG configurations in a US Galaxy firmware's CP member, why none is tied to a carrier, and why only Snapdragon models are read."
updated: 2026-10-06
---

A [carrier pack](/wiki/samsung/carrier-pack) configures Android. The modem has per-carrier configurations of its own, in the firmware's `CP` member.

## CP

The `CP` member holds `modem.bin`, plain or LZ4-compressed: a FAT volume laid out as a Qualcomm Pixel's modem partition (NON-HLOS). Its configurations are MCFG images, `mcfg_sw.mbn`, each named by the label in its trailer, and read as on a Pixel: see [Pixel modem configuration § Qualcomm](/wiki/android/pixel-modem#qualcomm).

The firmware names its chipset, not its modem: `KAANAPALI` in `MPSS.DE.9.0-01972.5-KAANAPALI_GEN_PACK-1.129782.405`, the Galaxy S26's. [PhoneDB](https://phonedb.net/index.php?m=processor&id=1055&c=qualcomm_snapdragon_8_elite_gen_5_sm8850-1-ad_for_galaxy__kaanapali) lists KAANAPALI as the SM8850 for Galaxy, with a Qualcomm X85 modem.

In `S942UOYN4BZID` there are 31 configurations, from `ATC` to `VTR_FIZ`, among them `ATT`, `TMB`, `USC`, `CDMAless-Verizon`, `Dish_US_Commercial`, `CBRS_US_Commercial`, `Canada_Open`, `Rakuten_Japan_Commercial` and `Skylo`: [the list](/samsung/builds/S942UOYN4BZID/SM-S942U).

## No SIM selection

A Qualcomm Pixel's hardware configurations carry `mcfg_sel_db.xml`, the rules that pick a configuration from the SIM. A Galaxy's carry none, and the Galaxy S25's `libsec-ril.so` in the vendor partition maps no SIM to an MBN either. How a Galaxy picks a configuration is ???.

So this site shows a Galaxy's modem configurations by firmware, not by carrier: a carrier pack's page has no Modem tab.

## Snapdragon only

Only US models are read. In the Exynos Galaxy S26 (`SM-S942B`), `modem.bin`'s sections each start with a `BiEn` header and share one wrapped key, and the `MAIN` section's payload looks random (8.000 bits of entropy per byte), so the image appears to be encrypted.

## See also

- [Carrier pack](/wiki/samsung/carrier-pack)
- [Pixel modem configuration](/wiki/android/pixel-modem)
- [.der.pri](/wiki/ios/der-pri): an iPhone's modem settings, shipped in its carrier bundle
