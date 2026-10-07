---
title: Profiles
searchTitle: "Profiles: carrier settings in one shape"
description: "How this site turns an iOS bundle, a Pixel .pb file or a Galaxy pack into one platform-neutral profile: concepts, raw settings, variants and SIM identity, stored by content hash, and the defaults read under a carrier."
updated: 2026-10-06
---

A **profile** is one carrier file's settings in a shape every platform shares: an iOS [carrier bundle](/wiki/ios/carrier-bundle), a Pixel [CarrierSettings](/wiki/android/carrier-settings) file or a Galaxy [carrier pack](/wiki/samsung/carrier-pack), each read into the same fields. Pages and the API compare carriers across platforms through profiles, and show each file's own settings through them too.

## Fields

From `packages/schema/src/types.ts`:

| Field      | What                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `source`   | the source the file is: platform, kind (`carrier`, `country`, `default`) and name (`ios`, `carrier`, `ATT_US`)                           |
| `sha`      | the SHA-256 of the file it was read from                                                                                                 |
| `identity` | the name the file shows, its countries (ISO 3166), and the SIMs it claims                                                                |
| `apns`     | its APNs, each with its types, protocols and where in the file it is                                                                     |
| `concepts` | its value of each concept the platform can express                                                                                       |
| `raw`      | every setting as the file states it: `carrier.plist:CarrierName` (Apple), `config:carrier_volte_available_bool`, `apns[0].apn` (Android) |
| `variants` | Apple only: what an MVNO configuration or a per-phone override file changes                                                              |

A profile has no version; identical bytes shipped under several versions or builds are one profile.

## Concepts

A **concept** is a setting that means the same on every platform: VoLTE, 5G Standalone, Wi-Fi Calling, an MMS size limit. There are 98, in 15 groups (`packages/schema/src/concepts.ts`). Each platform has a reader per concept, and a profile records for each concept one of:

| Value | Meaning                                                          |
| ----- | ---------------------------------------------------------------- |
| state | `on`, `available` (a switch, or decided per plan or SIM) or `no` |
| value | a number, a string or a list                                     |
| unset | the file leaves it unset                                         |

A concept the platform cannot express is absent. A state or value also names the settings it was read from, and how closely it matches: `exact`, `derived` (from several settings) or `approx` (the closest equivalent).

## Variants

An Apple bundle changes per SIM and per phone. Each `MVNOOverrides` configuration is a variant selected by SIM rules, and each `overrides_<boards>.plist` a variant selected by boards (`D93`). A variant holds only the concepts and APNs that differ. A Pixel's and a Galaxy's files differ per device instead, so each device's copy is a profile of its own and their variants are empty.

## SIM identity

A profile's SIMs are the rules its own file states: an iOS bundle's `SupportedSIMs`, a Galaxy pack's carrier list in `omc.info`. A rule is an MCC-MNC with at most a GID1, GID2, SPN, IMSI prefix or ICCID prefix, and has one key in the index: `310260`, `310260|gid1=6D38`. A Pixel file names no SIMs; [carrier_list.pb](/wiki/android/carrier-list) routes SIMs to it, as Apple's manifest routes them to a bundle. Those routing tables are `routes` rows, not part of a profile.

## Content addressing

| Kind of artifact           | Stored at      | Normalized to                                                  | Per step |
| -------------------------- | -------------- | -------------------------------------------------------------- | -------- |
| `apple.ipcc`               | `obj/<sha256>` | a profile                                                      | 100      |
| `android.carrier-settings` | `obj/<sha256>` | a profile                                                      | 100      |
| `samsung.omc`              | `obj/<sha256>` | a profile                                                      | 100      |
| `android.modem-config`     | `obj/<sha256>` | a modem configuration, its base and its band-combination lists | 10       |
| `apple.bbfw`, `apple.ftab` | `obj/<sha256>` | nothing                                                        |          |
| `android.carrier-list`     | `obj/<sha256>` | nothing; its rules become `routes` rows                        |          |

An artifact is stored once under the SHA-256 of its bytes, and its profile at `norm/v7/<sha>.json`, read from those bytes alone (7 is `PROFILE_SCHEMA`). When the profile's shape changes, the schema number is raised and a reindex reads every held artifact again into the new `norm/` prefix.

A bundle copied out of an iOS image is packed into an `.ipcc` deterministically, so identical copies from two IPSWs are one artifact.

## Defaults

A carrier file sets only what differs from the phone's defaults. What a phone reads for a feature its carrier leaves unset comes from the layers under it, first one that decides it:

| Phone  | Carrier file                                    | Then                                                           | Then                                   |
| ------ | ----------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| Pixel  | `<canonical name>.pb`                           | the build's `default.pb`                                       | AOSP's `CarrierConfigManager` defaults |
| Galaxy | the pack's IMS operator's entries               | the IMS service's defaults (`defaultswitch`, `defaultsetting`) |                                        |
| iPhone | `carrier.plist`, with the phone's override file | none                                                           |                                        |

A layer either decides a state wholly, or only the part the carrier leaves open: a carrier file can offer a feature while `default.pb` says whether it starts on. Pages mark a state a layer decided, and which layer.

## See also

- [How carrier-explode works](/wiki/pipeline/overview)
- [Indexing](/wiki/pipeline/indexing): what is derived from profiles
- [Bundle Selection](/wiki/ios/bundle-selection), [carrier_list.pb](/wiki/android/carrier-list), [Carrier pack § SIM selection](/wiki/samsung/carrier-pack#sim-selection)
