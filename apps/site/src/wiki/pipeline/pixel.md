---
title: Pixel ingest
searchTitle: "Pixel ingest: OTA payloads and the update service"
description: "How this site reads Pixel carrier files: each Pixel's full OTA read in place by HTTP Range, its CarrierSettings, carrier_list.pb and modem configurations kept, and Google's carrier settings update service."
updated: 2026-10-06
---

**Pixel ingest** is how this site gets a Pixel's [CarrierSettings](/wiki/android/carrier-settings) and [modem configuration](/wiki/android/pixel-modem): from the full OTA image of each in-scope Pixel, one Pixel and build at a time, and from the newer files Google's carrier settings update service names for a build.

## Feeds

| Source                                                                         | Gives                                                                       |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [Android OTA images](https://developers.google.com/android/ota)                | each Pixel's name and its full OTAs: build, Android version, month, zip URL |
| [Build numbers](https://source.android.com/docs/setup/reference/build-numbers) | builds the OTA page no longer lists, which date each Pixel's first build    |
| Google's carrier settings update service                                       | carrier files newer than a build's own, per Pixel and train                 |

Both pages are checked daily at 03:35 UTC, the update service every 6 hours.

## Pixel builds

A unit is one Pixel's OTA of one build (`pixel-device-CP3A_260905_009-frankel`), because each Pixel has its own OTA and its own copy of every carrier file. It is held once `releases/android/<build>/<device>.json` is written.

### Reading an OTA in place

Nothing downloads a whole OTA. The zip's central directory is read from its tail by HTTP Range, then `payload.bin`'s manifest. A partition is read through the payload's install operations: a filesystem read fetches only the operations that write the blocks it needs, decompresses them (XZ, BZ2 or Zstandard). The partitions are ext4, EROFS or FAT images.

### Steps

| Step          | Reads                                                                                                                          | Keeps                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `plan`        | the modem partition, if any                                                                                                    | the modem's family: Qualcomm, Shannon or MediaTek                                        |
| `settings`    | `etc/CarrierSettings` in `product` (or `system/product/etc/CarrierSettings` in `system` on Pixels without a product partition) | each `.pb` file, `others.pb` split into one file per carrier, and `carrier_list.pb`      |
| `modem items` | Shannon only: `modem.bin`, streamed                                                                                            | the table of item names, by the CRC-32 of each name                                      |
| `modem`       | the modem and vendor partitions                                                                                                | each modem configuration                                                                 |
| `normalize …` | the stored artifacts                                                                                                           | a [profile](/wiki/pipeline/profiles) per settings file; a modem configuration per config |
| `release`     | `tmp/`                                                                                                                         | the release record, last                                                                 |

Pixels of one build share many files: in `CP3A.260905.009`, `tmobile_us.pb` exists in 11 versions across 20 Pixels.

### What is kept

| File                                   | In R2                                           | Becomes                                                                     |
| -------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| a carrier's `.pb`, an `others.pb` part | `obj/<sha256>`, kind `android.carrier-settings` | a source: a profile, and a copy on the Pixel's line                         |
| `default.pb`, `no_sim.pb`              | the same                                        | default sources; `default.pb` is read under every carrier file of the build |
| `carrier_list.pb`                      | `obj/<sha256>`, kind `android.carrier-list`     | `routes` rows: the SIM rules that send a SIM to each carrier                |
| a modem configuration                  | `obj/<sha256>`, kind `android.modem-config`     | a modem configuration with its base and band-combination lists in `norm/`   |

## The update service

Google publishes carrier files for a Pixel between builds. The service is `getExperimentsAndConfigs` on `www.googleapis.com`, asked for the Phenotype flags of `com.google.android.carrier`; its `CarrierSettings__update_config` flag lists each file newer than a build's own, with its version and URL on `ssl.gstatic.com`. The request and the flag's layout are [GrapheneOS/adevtool](https://github.com/GrapheneOS/adevtool)'s.

The check asks about each held Pixel's newest train, the first four characters of a build (`CP3A`). A new set of answers is stored at `ota/pixel/snapshots/<sha1>.json` and becomes a unit, which plans each file whose record is missing or listed differently. Each file is checked against the SHA-256 Google serves beside it at `<url>.sha256` (files from 2023 and before have none), stored in `obj/`, normalized, and recorded at `ota/pixel/files/<sha256 of its URL>.json` with every Pixel and train that lists it. A listed `carrier_list` must have the version the answer states.

## See also

- [How carrier-explode works](/wiki/pipeline/overview)
- [CarrierSettings](/wiki/android/carrier-settings), [carrier_list.pb](/wiki/android/carrier-list)
- [Pixel modem configuration](/wiki/android/pixel-modem)
