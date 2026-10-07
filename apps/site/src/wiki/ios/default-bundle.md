---
title: Default bundle
searchTitle: "Default.bundle: the iOS fallback carrier bundle"
description: "Default.bundle - the fallback carrier bundle, and the 18 MB of alert sounds, lookup tables, regional modem tables and motion thresholds that ship in it."
updated: 2026-10-02
---

**Default.bundle** is the carrier bundle every iPhone has whatever SIM is in it. Its `carrier.plist` holds fallback settings, and the bundle also carries a lot of data that has nothing to do with any one carrier. Unpacked it is 18 MB, by far the largest bundle; most of that is emergency alert sounds.

It is only shipped inside iOS images, in `/System/Library/Carrier Bundles/iPhone/Default.bundle`, and is not in the [manifest](/wiki/ios/carrier-bundle-manifest).

## Contents

From iOS 27.0.1 (24A446, iPhone 16 Pro image):

| Files                                                                                                       | What                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `carrier.plist`                                                                                             | fallback settings; names the lookup tables below                                                                       |
| `overrides_D93.plist`, `overrides_D93.der.pri`                                                              | for the phone the image is for                                                                                         |
| `global_setting_B.der.gri` to `_L`                                                                          | regional modem tables. See [.der.gri](/wiki/ios/der-gri)                                                               |
| `cbs_*.caf` (17)                                                                                            | emergency alert sounds                                                                                                 |
| `cbs_vibe_ca.plist`, `cbs_vibe_cl.plist`, `cbs_vibe_us.plist`                                               | emergency alert vibration patterns                                                                                     |
| `TS25.txt`, `TS25_Annex.txt`                                                                                | network names                                                                                                          |
| `SIDTable.txt`                                                                                              | CDMA SIDs                                                                                                              |
| `equivalent_bundle_table.txt`                                                                               | networks that count as the same carrier                                                                                |
| `MCC2ISO.plist`, `ISO2MCC.plist`, `MNC2ISO.plist`, `MCCMNC2ISO3.plist`, `ISO3ToMCCMNC.plist`, `EUISO.plist` | country code tables                                                                                                    |
| `com.apple.bodythreshold_*.plist` (29)                                                                      | on-body detection thresholds                                                                                           |
| `*.loctable`                                                                                                | localised strings: `Akey`, `AlertDialog`, `Carriers`, `CellBroadcast`, `Ciphering`, `DataUsage`, `Otasp`, `UserLabels` |

`Akey` and `Otasp` are CDMA-era strings (A-key exchange, over-the-air service provisioning). `Ciphering` is presumably the warning shown when the network turns encryption off.

## Lookup tables

`carrier.plist` names three of the text tables and their versions:

```
TS25FileName                    TS25.txt
TS25AnnexFileName               TS25_Annex.txt
TS25Version                     69.0
SIDTableFileName                SIDTable.txt
SIDTableVersion                 1.1
EquivalentBundleTableFileName   equivalent_bundle_table.txt
EquivalentBundleTableVersion    1.5
```

`Default` is the only bundle with these keys. The equivalent bundle table itself says `# Version: 1.6`.

### TS25.txt

A copy of the GSMA's TS.25 list of network names, 833 networks, semicolon separated:

```
03-09-26 69.0
PPCI&N;Abrev. Net. Name;MCC;MNC;Country Initials;Organisation;Network;SIM;Last Update
AeroMobile;AeroMob;901;14;AAA;AeroMobile AS;AeroMobile;8988299;2016-03-02 12:07:50
Telenor Maritime;TelenorM;901;12;AAM;Telenor Maritime AS;Telenor Maritime;8988232;2016-03-16 13:08:22
```

The first line is a date and the version. `TS25_Annex.txt` (version 7.0) overrides a few names:

```
Tele2 SE;Tele2 SE;240;07
U.S. Cellular;U.S. Cellular;311;580
```

### SIDTable.txt

CDMA System IDs to carriers, for the US carriers that used CDMA:

```
# SID Code(s)|Carrier/Country Using SID (s)
4103|"310120_GID2-11,310120_GID2-01,310120,310SPR"|"Sprint Nextel (Anniston, AL; Birmingham, AL; ...)"
```

### `equivalent_bundle_table.txt`

23 lines. Each maps an MCC+MNC to the SIMs it should be treated as:

```
310260|310260_GID1-54
311870|310120_GID2-11,310260_GID1-54
311490|310120_GID2-11,310260_GID1-54
310410|310410_GID1-FFFF
44092|44054,44051
44093|44020
```

311870 and 311490 (Sprint-era networks) are mapped to both Sprint and T-Mobile SIMs. The 440xx lines are Japanese networks.

## Emergency alert sounds

```
cbs_alert_us.caf                    1.9 MB
cbs_alert_cl.caf                    1.9 MB    (Chile)
cbs_alert_ca.caf                    154 KB    (Canada)
cbs_alert_jp.caf                    83 KB
cbs_disaster_warning_jp.caf         78 KB
cbs_tsunami_warning_jp.caf          865 KB
cbs_local_earthquake_us.caf         1.0 MB
cbs_translated_earthquake_en.caf    (also es, ko, pt, zh)
cbs_translated_tsunami_en.caf       (also es, ko, pt, zh)
```

Country bundles pick these by name; `Australia` has:

```
CellBroadcast.AlertConfigurations.Configuration_us
    Sound       cbs_alert_us.caf
    Vibration   cbs_vibe_us.plist
```

The vibration plists are a pattern of on/off times in milliseconds:

```
cbs_vibe_us.plist   Intensity 1
                    VibePattern   on 2000, off 500, on 1000, off 500, on 1000, off 500,
                                  on 2000, off 500, on 1000, ...      (long, short, short)
```

## Body thresholds

29 files, `com.apple.bodythreshold_H.plist` to `_Z` and `_AA` to `_AJ` (no `A` to `G`). Each holds the parameters of a classifier for CoreMotion's on-body detection:

```
CMOnBodyStatusManagerClassifierTheta0       -0.339407949489699
CMOnBodyStatusManagerClassifierTheta1        0.438611614723492
CMOnBodyStatusManagerClassifierTheta2       -0.140731759536211
CMOnBodyStatusManagerConfidenceThreshold     0.3
CMOnBodyStatusManagerClassifierMaxHighPower  10
CMOnBodyStatusManagerClassifierMinLowPower   0.0035
```

Whether the phone is held against the body matters for transmit power limits (SAR), which is presumably why it is in a carrier bundle. What the letters stand for is ???.

## See also

- [.der.gri](/wiki/ios/der-gri)
- [Carrier Bundle § Special bundles](/wiki/ios/carrier-bundle#special-bundles)
