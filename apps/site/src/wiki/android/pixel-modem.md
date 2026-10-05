---
title: Pixel modem configuration
searchTitle: "Pixel modem configs: Qualcomm, Shannon, MediaTek"
description: "Where each Pixel's modem keeps its per-carrier configuration: Qualcomm MCFG files, Samsung Shannon cfg.db, manifests and confseqs, and MediaTek MCF files."
updated: 2026-10-04
---

[CarrierSettings](/wiki/android/carrier-settings) configures Android. The modem has a per-carrier configuration of its own, shipped in the same OTA in the modem and vendor partitions, with its own tables for choosing one from the SIM. Its format depends on who made the modem:

| Modem | Pixels | Per-carrier file | Chosen by |
|-------|--------|------------------|-----------|
| Qualcomm | the first Pixel to the Pixel 5a | `mcfg_sw.mbn` | `mcfg_sel_db.xml` in the `mcfg_hw.mbn` files |
| Samsung Shannon | Pixel 6 to Pixel 10a | a manifest and its confseqs | `cfg.db` |
| MediaTek | Pixel 11 | `MTK_OPOTA_SBPID_<n>.mcfopota` | ??? |

The Shannon and MediaTek layouts on this site were read from the Pixel files themselves; neither has a public description.

The site shows each build's modem firmware by Pixel, with the configuration it loads whatever the carrier: [Pixel 9 in CP3A.260905.009](/android/builds/CP3A.260905.009/tokay). A carrier's configuration, and the SIMs that select it, are on the carrier's Modem tab.

## Qualcomm

The modem partition (Qualcomm's NON-HLOS) is a FAT filesystem. `version.cfg` names the firmware, `SSD:<label>`: at the root on the Pixel and Pixel XL, in `image/` after that.

Each carrier configuration is an MCFG image, `mcfg_sw.mbn`, named by the label in its `MCFG_TRL` trailer (`Commercial-TMO`, `3HK_Commercial_HongKong`). It holds NV items and EFS files, the kind of settings an iPhone's [.der.pri](/wiki/ios/der-pri) carries. Hardware configurations, `mcfg_hw.mbn`, sit beside them. Where they are, from `QP1A.190711.019` (Android 10) and `SP1A.211105.002` (Android 12):

| Pixel | Directory |
|-------|-----------|
| Pixel XL | `modem/modem_pr/mcfg/configs/` |
| Pixel 2 XL | `vendor/mbn/mcfg/configs/` |
| Pixel 3a XL, Pixel 4 XL | `vendor/rfs/msm/mpss/readonly/vendor/mbn/` |

`mcfg_sw/` is a tree by region and carrier (`mcfg_sw/generic/SEA/3HK/Commercial/HK/mcfg_sw.mbn`). The Pixel XL has 17 configurations in `QP1A.190711.019`; the Pixel 3a XL has 140.

The hardware configurations carry the selection database, `/nv/item_files/mcfg/mcfg_sel_db.xml`: rules in the style of policyman XML that test the SIM's IIN, IMSI PLMN (3GPP or 3GPP2), GID, IMPI or a custom ID, and name a carrier index. Each `mcfg_sw.mbn` carries its carrier index in its header. Some hardware configurations also carry `/policyman/band_combos_per_plmn.xml`.

## Samsung Shannon

The modem partition holds `images/<label>/`, which `images/default` links to; `<label>` is the firmware's name (`g5400c-260604-260807-B-16035863` for the Pixel 9 in `CP3A.260905.009`). The firmware is `modem.bin` there, gzipped on some builds. The carrier configuration is in the vendor partition, under `firmware/carrierconfig/`:

| File | What |
|------|------|
| `cfg.db` | SQLite. `carrier_info` lists each carrier's SIMs; `confmap` names the manifest that configures each carrier |
| `manifests/<sha1>` | a protobuf: one configuration's name (`us_tmo`, `wildcard_5g`), its carrier ID, and the confseqs it is built from |
| `confseqs/<sha1>` | a protobuf: one layer of settings, named `<layer>.<scope>` (`us_tmo.sim1`, `lte_ca_common.common`), sometimes LZ4-compressed behind a `CLZ4` header |

A `carrier_info` row matches on MCC-MNC, IMSI prefix, SPN, GID1, GID2 and ICCID prefix, as SQL `LIKE` patterns with `%` for any, and may name the SHA-256 of the carrier's signing certificate.

A manifest lists its confseqs by scope: `common`, `sim1`, `sim2` or `multislot`. It can also install a file, such as a root certificate in PEM. Layers every manifest uses (`default`, `endc_*`, `lte_ca_*`) are marked as base layers.

A confseq item is a 32-bit key and a list of 64-bit integers; there is no other value type. The key is the CRC-32 of the item's name, and the names are in none of these files: they are found by hashing the strings in `modem.bin`.

`firmware/uecapconfig/` holds UE capability band combinations: EN-DC and NR carrier aggregation per carrier index, with `ap_plmn_mapping` giving each index's PLMNs, and LTE carrier aggregation in `lte_<n>` files that belong to no one carrier.

In `CP3A.260905.009` the firmware of the Pixel 6, 6 Pro and 6a has 163 configurations, that of the Pixel 8 and 8 Pro 270, and that of the Pixel 9 family 279.

## MediaTek

The modem partition holds `images/<label>/` as on Shannon Pixels, with the carrier configuration in `mcf/mtk_default/`. Each operator has an OP-OTA file, `MTK_OPOTA_SBPID_<n>.mcfopota`, and some an NW-OTA file, `MTK_NWOTA_SBPID_<n>.mcfnwota`, for network settings.

`<n>` is an SBP ID, MediaTek's number for an operator (`OPnn` on the Android side): 8 is `TMO US`, 1 is `CMCC`. The names come from MediaTek code published elsewhere and from the Pixel 11's own file names; in `CD1A.260905.001.B1`, 87 of the 406 SBP IDs have one.

An MCF file is a header listing the NVRAM logical IDs (LIDs) it sets and the items in each, the modem build it was made for, then checksummed data sections of item records. A record can have a condition, such as `<sbp>_<mcc>_<mnc>` with `NA` for any part, so one file can set different values for different networks.

Items are numbered, not named. The modem image names only the SBP items: the operator feature switches, one bit each, and operator values, one byte each, of the `SBP` LIDs. Neither it nor the vendor partition says what any value means.

## See also

* [CarrierSettings](/wiki/android/carrier-settings)
* [carrier_list.pb](/wiki/android/carrier-list): how Android, rather than the modem, matches a SIM
* [.der.pri](/wiki/ios/der-pri): an iPhone's modem settings, shipped in its carrier bundle
