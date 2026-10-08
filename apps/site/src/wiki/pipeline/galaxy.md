---
title: Galaxy ingest
searchTitle: "Galaxy ingest: FUS firmware, CSC, CP and AP"
description: "How this site reads Galaxy firmware: models found through Google Play's device list and builds through Samsung's version.xml, the firmware streamed from Samsung's FUS and decrypted on the way, carrier packs from CSC, modem configurations from CP, IMS operators from AP."
updated: 2026-10-07
---

**Galaxy ingest** is how this site gets a Galaxy's [carrier packs](/wiki/samsung/carrier-pack) and [modem configurations](/wiki/samsung/galaxy-modem): from the firmware of each in-scope model, in every region Samsung sells it, as Samsung's firmware update server (FUS) serves it. FUS offers a model's current firmware only, so a Galaxy's history here begins when this site began reading it.

## Feeds

| Source                                                                                              | Gives                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [Google Play's supported devices](https://storage.googleapis.com/play_public/supported_devices.csv) | each Galaxy model, every regional variant (`SM-S942B`, `SM-S942U`, `SM-S942N`, …), and its name, which gives its family and generation |
| Samsung's `version.xml` (`fota-cloud-dn.ospserver.net/firmware/<region>/<model>/version.xml`)       | a model's builds under one sales code, and so its multi-CSC package                                                                    |
| FUS (`neofussvr.sslcs.cdngc.net`)                                                                   | the firmware file, its build day and the model's name                                                                                  |

`version.xml` answers for a sales code (`EUX`), never for the multi-CSC package that carries it (`OXM`), and Samsung publishes no list of either, so the scope names the sales codes to ask. A check asks each model under each of them once, keeps what was answered in `firmware/samsung/sales-codes/<model>.json`, and from then on asks under the first code that answered for each package; a code that answered nothing is asked again after 30 days. Requests go one at a time.

The lists are checked every 20 minutes, at 10, 30 and 50 past the hour. A check asks FUS about a build once, for its Android version, build day and model name, keeps the answer in `firmware/samsung/<build>.json`, and asks one build at a time: FUS's firewall refuses a burst. A refusal fails the check or step without a retry. The FUS client is a port of [SamloaderKotlin](https://github.com/zacharee/Bifrost) (now Bifrost, MIT): a nonce from `NF_SmartDownloadGenerateNonce.do`, `NF_SmartDownloadBinaryInform.do` for the file, `NF_SmartDownloadBinaryInitForMass.do` to ready it, then the download from `cloud-neofussvr.samsungmobile.com`.

## Galaxy builds

A unit is one model's firmware, named by its CSC build (`galaxy-build-S942UOYN4BZID`), and held once `releases/samsung/<build>.json` is written. A firmware carries the pack of every sales code in its multi-CSC package (`OYN` the US carriers', `OXM` dozens of countries'), so each firmware is read once, whichever sales code it was found under.

### Reading the firmware

The firmware is a zip of tar members (`BL`, `AP`, `CP`, `CSC`, `HOME_CSC`, `USERDATA`), encrypted as a whole. The zip's directory is read by HTTP Range, and one member at a time is streamed through AES-128-ECB (the key derived from FUS's answer) and inflate.

### Steps

| Step      | Runs in   | Reads                                                                   | Keeps                                                                           |
| --------- | --------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `csc`     | Worker    | the `CSC` member, to `optics.img.lz4` (ext4 or EROFS)                   | each sales code's `conf/` files, in the unit's `tmp/`; the firmware's build day |
| `cp`      | Worker    | the `CP` member's `modem.bin`, streamed through LZ4 into the FAT reader | each MCFG configuration in `obj/`, with its modem configuration in `norm/`      |
| `ap`      | container | the `AP` member's `super.img.lz4`, decoded as it streams                | each sales code's IMS operator                                                  |
| `release` | Worker    | `tmp/`, the three outputs                                               | each pack in `obj/` and its profile; the release record, last                   |

The IMS maps are in `system/priv-app/imsservice/imsservice.apk`, in the `system` partition of `super`. The `ap` job reads `super`'s partition table from its first MiB, writes only the runs that belong to `system` to a sparse file, reads that as a filesystem, and opens the APK's `res/raw/`. It then matches each pack's SIM rules against `mnomap.json` to name the pack's IMS operator ([Carrier pack § IMS](/wiki/samsung/carrier-pack#ims)).

The `release` step adds the operator's entries to each pack as `imsservice/operator.json`, packs the files, and stores the pack under its SHA-256.

## Scope

Every model Google Play lists as a Galaxy S, Z Fold, Z Flip, A5x or A3x, FE models aside, that launched in January 2025 or later, dated by its oldest build in `version.xml`. Of the newest three Android versions, each is read on each family's newest generation that has it, in each of a model's multi-CSC packages: Android 17 on the Galaxy S26, Android 15 on the S25, which the S26 never ran. An Exynos model's firmware gives carrier packs but no modem configurations ([Galaxy modem configuration § Exynos](/wiki/samsung/galaxy-modem#exynos)).

## See also

- [How carrier-explode works](/wiki/pipeline/overview)
- [Carrier pack](/wiki/samsung/carrier-pack)
- [Galaxy modem configuration](/wiki/samsung/galaxy-modem)
