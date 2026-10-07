---
title: CarrierSettings
searchTitle: "Pixel CarrierSettings: the carrier files in a build"
description: "The etc/CarrierSettings directory in every Pixel build: its .pb files, others.pb, default.pb and no_sim.pb, how they differ per Pixel, and their versions."
updated: 2026-10-04
---

**CarrierSettings** is the directory of carrier settings in every Pixel build: `etc/CarrierSettings` in the product partition, or `/system/product/etc/CarrierSettings` in the system partition on the first two Pixel generations with Android 10 and 11, which had no product partition. Android 9 builds have no such directory.

Every file in it is a protocol buffer. The format is Google's; its two protos, and a tool that builds the same files from AOSP's XML configs, are public in AOSP as [`platform/tools/carrier_settings`](https://android.googlesource.com/platform/tools/carrier_settings/).

## Where it comes from

This site reads the directory from Google's full OTA images ([Android OTA images](https://developers.google.com/android/ota)): the OTA zip holds a `payload.bin`, the payload holds the partitions, and the product (or system) partition is a filesystem image with the directory in it. Each Pixel has its own OTA, so each Pixel's copy is read separately.

## Files

From `CP3A.260905.009` (Android 17, September 2026):

| File                  | What                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `carrier_list.pb`     | which SIMs belong to which carrier, by canonical name. See [carrier_list.pb](/wiki/android/carrier-list)                               |
| `<canonical name>.pb` | one carrier's settings, named after the carrier (`tmobile_us.pb`). See [CarrierConfig and APNs](/wiki/android/carrier-config)          |
| `others.pb`           | the settings of every carrier without a file of its own, in one file                                                                   |
| `default.pb`          | the `default` carrier, which `carrier_list.pb` gives MCC-MNC `000000`: AOSP's converter puts the configs meant for every carrier there |
| `no_sim.pb`           | named for a phone with no SIM; the one file `carrier_list.pb` never names                                                              |
| `label`               | on some builds; not a protobuf. It names the carrier data release the directory was built from                                         |

The site splits `others.pb` into its parts and treats each as a carrier of its own, so the build has 1,320 carriers: [Android carriers](/android/carriers).

### Canonical names

A carrier's name is usually `<carrier>_<country>` (`tmobile_us`, `vodafone_de`), as the proto's comments describe it. Carriers in `others.pb` mostly have generated names instead: the MCC-MNC, plus the MVNO rule when there is one (`20404`, `20404SPN=JUMP`, `310260GID1=2801`). AOSP's converter names every carrier that is not tier 1 that way. 572 of the 1,320 carriers in the build have such a name.

### Tier 1 and others

AOSP's tool writes a file for each tier-1 carrier and puts all other carriers in `others.pb`. Only tier-1 files get per-device overlays; the tool's comment gives the reason as keeping version numbers increasing, which an overlay on `others.pb` would make hard.

In every build this site has read, the parts of `others.pb` carry no version of their own; they share the version of `others.pb`. When a carrier is in `others.pb` and has its own file too, as `telenor_se` does on Android 12 and 13, this site keeps the file.

## Per Pixel

Every Pixel in a build has the same `carrier_list.pb`, but the settings files differ. In `CP3A.260905.009`, `tmobile_us.pb` exists in 11 versions across 20 Pixels, so on this site an Android carrier's versions sit under a Pixel: [tmobile_us on the Pixel 9](/android/carriers/tmobile_us/tokay/79000000034).

## Versions

A version is a 64-bit integer:

| Build                | Android       | `tmobile_us.pb`                |
| -------------------- | ------------- | ------------------------------ |
| `QP1A.190711.019`    | 10            | `10000000044` to `10000000048` |
| `SP1A.211105.002`    | 12            | `30000000108`, `30000000114`   |
| `CP3A.260905.009`    | 17            | `79000000013` to `79000000181` |
| `CD1A.260905.001.B1` | 17 (Pixel 11) | `80000000020`                  |

AOSP's tool builds a version in two parts. Everything from 10<sup>9</sup> up is an offset for the release or branch, a multiple of 10<sup>9</sup>; the rest is the file's own version, which must stay below 10<sup>9</sup>. A device overlay adds its own version to the base file's, which is why one carrier's version differs between Pixels of the same build.

The offset changes with the release (10, 30, 79), and `CD1A.260905.001.B1`, a Pixel 11 build, has one of its own (80).

## See also

- [carrier_list.pb](/wiki/android/carrier-list)
- [CarrierConfig and APNs](/wiki/android/carrier-config)
- [Pixel modem configuration](/wiki/android/pixel-modem): the modem's own per-carrier settings
- [Carrier Bundle](/wiki/ios/carrier-bundle): the iOS counterpart
