---
title: Indexing
searchTitle: "Indexing: timelines, phone states and carrier links"
description: "How this site indexes what it extracts: facts written per record, then each source's timeline, head, changes and phone states derived, and sources linked into carriers by the SIMs they claim."
updated: 2026-10-06
---

**Indexing** turns the records units write into rows of the D1 index (`carrier-explode-index`). It runs only in the extractor's index queue consumer, one message at a time, and in two parts: **facts**, written once per record, and **derivations**, computed from all the facts of a platform. Derivations come from `packages/schema`.

## Messages

| Message    | Sent by                            | Does                                                       |
| ---------- | ---------------------------------- | ---------------------------------------------------------- |
| `release`  | a build unit's last step           | writes the record's facts                                  |
| `ota`      | an OTA unit, for its files         | writes the files' facts                                    |
| `routes`   | an Apple OTA unit                  | writes the manifest's SIM routes                           |
| `rederive` | indexing, a feed check, or by hand | starts a platform's derivation                             |
| `derive`   | a rederive                         | derives 25 sources, then 25 releases' changes, per message |
| `reindex`  | a reindex of every held record     | writes one record's facts                                  |

Derivation runs once after a burst of facts, not once per record. A `release` or `ota` message reads at most about 96 MB of new profiles; one with more left queues itself again. A message that writes anything queues a cache purge.

## Facts

Written once per content hash or per unit:

| Table                     | One row per                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `releases`                | build (iOS, Galaxy) or build and Pixel                                                 |
| `copies`                  | copy of a source's content on a line, from a release or an OTA file                    |
| `profiles`                | profile, by hash: its identity, and what it says of a phone's 5G radio                 |
| `sims`                    | SIM rule a profile claims, or a modem configuration selects                            |
| `routes`                  | SIM rule a platform's routing sends to a source                                        |
| `modems`, `modem_configs` | modem a release ships to some devices, and each configuration a device's modem carries |
| `ota_files`               | file of an OTA feed                                                                    |
| `devices`                 | phone a feed lists: boards, release day                                                |

## Timelines

A source's **timeline** is one entry per distinct content on each of its **lines**, newest first. A line is where one copy of a source lives:

| Platform | Lines                                                                               | Example                                          |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| Apple    | the main line; a model's own line where the manifest gives it one (`ByProductType`) | `/ios/carriers/ATT_US/72.0`                      |
| Pixel    | one per Pixel, by codename                                                          | `/android/carriers/tmobile_us/tokay/79000000034` |
| Galaxy   | one per model                                                                       | `/samsung/carriers/TMB/SM-S942U/17.0013`         |

An entry is named by the file's own version. When two contents share a version, the older is named by where it first appeared: `64.1@23a341` for an iOS build, `50.1@2022-04-12` for an OTA download. A source's **head** is the newest release on its default line, or its newest beta when it has no release; on Android, the newest Pixel's line.

## Changes and phone states

A release's **changes** are its sources against the release before it on its platform, by version: each source `added`, `removed` or `changed`, counted on every device, and linked to the entries on each side.

A **phone state** is what one phone reads from one carrier source for each feature, for every phone an indexed release lists:

| Phone  | Reads                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| iPhone | the source's head, with its own [override file](/wiki/ios/bundle-selection#per-phone-overrides) as a variant |
| Pixel  | the file the newest build carrying the source ships it, over that build's `default.pb`                       |
| Galaxy | its own model's newest pack                                                                                  |

A state the carrier leaves unset is read from the [defaults](/wiki/pipeline/profiles#defaults) under it, and marked so.

## Per source

| Table           | Holds                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `entries`       | the timeline                                                                                               |
| `sources`       | the head's hash; for a Pixel source, the `default.pb` its newest phone reads it over; when it last changed |
| `settings`      | the head's every setting, as the file states it                                                            |
| `base_settings` | each `default.pb`'s settings, by hash: what a setting search shows for a key a head leaves unset           |
| `concepts`      | the head's concept values                                                                                  |
| `phone_states`  | each phone's state of each feature                                                                         |
| `changes`       | each release's changes                                                                                     |

Only heads have their settings in D1; an older version is read from its profile in R2.

## Carriers

A **carrier** is one or more sources, across platforms, linked by the SIM rules they claim. A source's rules are those of its head's identity and those its platform's routing sends it. A source's best match on another platform is the source there it shares the most rules with. Two sources are linked when one is the other's only best match and the choice is mutual, or covers at least half of the choosing source's rules; a tie links nothing. Sources on one platform are never linked to each other by their rules.

Two kinds of rule never link anything ([About § Names and references](/wiki/credits#names-and-references)):

| Rules                            | Why                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| MCCs starting 0, 1 or 8, and 999 | assigned to no network by [ITU-T E.212](https://www.itu.int/rec/T-REC-E.212); test SIMs use them (`00101`, `99999`) |
| `246081`, `24681`                | the network [3GPP TS 31.121](https://www.3gpp.org/DynaReport/31121.htm) conformance tests simulate                  |

People correct the result in the `links` table, each with its reason: `link` joins two sources, `split` keeps two apart (for an Apple bundle, its iPad and Watch files too). Linking runs again whenever a head's identity changes, and at the end of every rederive. A carrier is named after its first member: Apple's before Pixel's before Galaxy's, then the one with most rules.

## Reindexing

After a decoder change and a `PROFILE_SCHEMA` or `MODEM_SCHEMA` bump, a reindex reads every held artifact from `obj/` into the new `norm/` prefix, then writes every held record's facts again, one record a message in key order, and ends with each platform's rederive.

## See also

- [How carrier-explode works](/wiki/pipeline/overview)
- [Profiles](/wiki/pipeline/profiles)
- [Storage and serving](/wiki/pipeline/serving)
