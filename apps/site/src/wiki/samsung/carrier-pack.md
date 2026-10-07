---
title: Carrier pack
searchTitle: "Galaxy carrier packs: CSC sales codes and omc.info"
description: "The carrier pack each sales code gets in a Galaxy firmware's CSC: omc.info, customer.xml and the feature files, how a SIM selects a pack, where its IMS settings come from, and its versions."
updated: 2026-10-06
---

A **carrier pack** is one sales code's carrier settings in a Galaxy firmware: its APNs, feature switches and the SIMs it is for. Samsung names each by a three-letter sales code (`TMB`, `VZW`, `ATT`). This site lists them as [Galaxy carriers](/samsung/carriers).

## Where it comes from

A Galaxy firmware, as Samsung's firmware update server (FUS) serves it, is a zip of tar members: `BL`, `AP`, `CP`, `CSC`, `HOME_CSC` and `USERDATA`. The packs are in the `CSC` member, inside `optics.img.lz4`, an LZ4-compressed filesystem image (ext4 or EROFS). Each pack is a `conf/` directory: `configs/carriers/<code>/conf` in US firmware, `configs/carriers/single/<code>/conf` elsewhere.

US firmware is multi-CSC: one firmware carries the pack of every US sales code. The `SM-S942U` firmware served for `ATT` and for `VZW` has identical `BL`, `AP`, `CP`, `CSC` and `HOME_CSC` members; only `USERDATA` differs. So this site reads each firmware once, named by its CSC build: [S942UOYN4BZID](/samsung/builds/S942UOYN4BZID) (Galaxy S26, Android 17) carries 19 packs.

Samsung offers a model's current firmware, not an archive of past builds, so a Galaxy's history on this site starts when the site began reading it. Which models are read is on [About](/wiki/credits#samsung-galaxy).

## Files

From `S942UOYN4BZID`, the `TMB` pack:

| File                                   | What                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `omc.info`                             | the pack's version (`SAOMC_SM-S942U_OYN_TMB_17_0013`), its model, a catalog of its parts and their editions, and its carrier list: the SIMs that select it |
| `customer.xml`                         | general information, the data profiles (APNs), and which profile serves each role (`ProfBrowser`, `ProfMMS`, `ProfIMS`)                                    |
| `system/cscfeature.xml`                | `CscFeature_*` switches for the whole pack                                                                                                                 |
| `system/customer_carrier_feature.json` | `CarrierFeature_*` switches per carrier group and per Samsung carrier ID                                                                                   |
| `imsservice/operator.json`             | not in the firmware's pack: the pack's IMS operator, which this site adds. See [IMS](#ims)                                                                 |

The two feature files may be encoded: a gzip stream with each byte rotated and XORed against a 256-byte table, as worked out by [fei-ke/OmcTextDecoder](https://github.com/fei-ke/OmcTextDecoder). Samsung reuses packs across models: four of the Galaxy S25's name the S23 or S24 Ultra in their `omc.info`.

## SIM selection

The carrier list in `omc.info` holds the pack's SIM rules. A rule has an MCC and MNC, and may add a GID1 (`gid`, in hex, or in decimal when `codeType` is `DEC`), a GID2, an SPN, a subset code (the IMSI digits after the network code) or an ICCID prefix.

`TMB` has 45 rules: 13 T-Mobile MCC-MNCs (`310160` to `310800`), each alone and with GID1 `544D` or `6D38`; GID1 `544D` on `311490`, `311882` and `312250`; GID1 `504E` on `311660`; and the test networks `00101` and `99999`. Every pack's rules are on its page: [TMB](/samsung/carriers/TMB).

## IMS

VoLTE, Wi-Fi Calling and the rest of a Galaxy's IMS settings are not in the pack. They are in the IMS service in the `AP` member's system partition, `system/priv-app/imsservice/imsservice.apk`, as JSON files in its `res/raw/`:

| File                  | What                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| `mnomap.json`         | SIM rules naming an operator (`mnoname`, such as `TMobile_US`)        |
| `imsswitch.json`      | each operator's IMS services switched on or off, over `defaultswitch` |
| `imsprofile.json`     | each operator's registration profiles: PDN, IP version, SIP timers    |
| `globalsettings.json` | each operator's other settings, over `defaultsetting`                 |

This site matches a pack's SIM rules against `mnomap.json` and keeps the operator most of them name, among those with switches, as `imsservice/operator.json`. `TMB`'s operator is `TMobile_US`. In the `SM-S948U` firmware `S948UOYN4BZID`, 17 of the 19 packs have one.

## Versions

A pack's version is the end of its `omc.info` version, `_<Android version>_<revision>`: `SAOMC_SM-S942U_OYN_TMB_17_0013` is version `17.0013`. Packs differ per model, so on this site a pack's versions sit under a model, as a Pixel's carrier files sit under a Pixel: [TMB on the Galaxy S26](/samsung/carriers/TMB/SM-S942U/17.0013).

## See also

- [Galaxy modem configuration](/wiki/samsung/galaxy-modem): the modem's own per-carrier settings
- [carrier_list.pb](/wiki/android/carrier-list): how a Pixel matches a SIM
- [Carrier Bundle](/wiki/ios/carrier-bundle): the iOS counterpart
