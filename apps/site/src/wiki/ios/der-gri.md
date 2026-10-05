---
title: .der.gri
searchTitle: ".der.gri: iPhone global baseband settings"
description: "The global_setting files in the Default bundle - regional baseband tables that apply whatever carrier is in the phone, in Qualcomm and Intel/Apple C1 flavours."
updated: 2026-10-02
---

A **.der.gri** file is a set of baseband settings that does not belong to a carrier. They are only found in the [Default bundle](/wiki/ios/default-bundle), as `global_setting_B.der.gri` to `global_setting_L.der.gri`. GRI is to PRI what "global" is to "carrier": the header says `GRI Revision` where a [.der.pri](/wiki/ios/der-pri) says `PRI Revision`. The container format is the same.

## Files

From `Default` in iOS 27.0.1 (24A446):

| File | Size | Format | Revision | Settings |
|------|------|--------|----------|----------|
| `global_setting_B.der.gri` | 282 KB | Intel / Apple C1 | 14.0.5 | 3090 |
| `global_setting_C.der.gri` | 7.6 KB | Qualcomm | 14.0.9 | 6 |
| `global_setting_D.der.gri` | 7.9 KB | Qualcomm | 14.0.9 | 8 |
| `global_setting_E.der.gri` | 8.2 KB | Qualcomm | 14.0.9 | 8 |
| `global_setting_F.der.gri` | 7.6 KB | Qualcomm | 14.0.9 | 6 |
| `global_setting_G.der.gri` | 341 KB | Intel / Apple C1 | 3.0.16 | 3849 |
| `global_setting_H.der.gri` to `_K` | about 8.2 KB | Qualcomm | 14.0.9 | 8 |
| `global_setting_L.der.gri` | 341 KB | Intel / Apple C1 | 3.0.16 | 3849 |

Which letter belongs to which modem or phone is ???. `G` and `L` have the same revision and the same keys.

## Qualcomm

The Qualcomm files are short. They write a few EFS files, mostly policyman databases:

```
/mdb/policyman/mcc2bands.mdb
/mdb/policyman/mcc2border.mdb
/nv/item_files/modem/nas/mav_lte_band_per_plmn
/nv/item_files/modem/nas/mav_lte_prio_sub_band_per_plmn
/nv/item_files/modem/nas/mav_pssi_reg_gfnh_allowed_plmn_per_geo_location
/nv/item_files/modem/mav/mav_china_sku_nal_supp
```

`mcc2bands` is which bands may be used in which country; `mcc2border` is presumably which countries border which, for scanning near a border.

## Intel and Apple C1

`B` has 3090 keys, all under `dyn_csi_cps_gri.gri_nvm`. `G` and `L` have 3849:

| Prefix | Keys | |
|--------|------|---|
| `dyn_cps_gri.lte_regulatory_info` | 2133 | LTE bands per MCC |
| `dyn_cps_gri.ecsr_whitelist` | 303 | ??? |
| `dyn_cps_gri.nr_nsa_regulatory_info` | 213 | 5G NSA bands per MCC |
| `dyn_cps_gri.nr_sa_regulatory_info` | 213 | 5G SA bands per MCC |
| `dyn_cps_gri.sat` | 121 | satellite |
| `dyn_cps_gri.plmn_band_pri_list[n]` | | band priority per network |

The regulatory tables are split by region, and each key names its region with a prefix: `na` (North America), `la` (Latin America), `eu`, `africa`, `asia`, `ocean`, `ww` (worldwide). LTE entries are band bitmaps; for `na_table` MCC 302 (Canada) the bitmap decodes to bands 2, 4, 5, 7, 12, 13, 14, 17, 25, 29, 30, 38, 41, 46, 53, 66 and 71. NR entries are written out as text, `302:2-5-7-12-...`.

## See also

* [.der.pri](/wiki/ios/der-pri)
* [Default bundle](/wiki/ios/default-bundle)
