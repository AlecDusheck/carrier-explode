---
title: How carrier-explode works
searchTitle: "How carrier-explode works: feeds, R2, D1, API"
description: "The pipeline end to end: feeds checked on a schedule, one Workflow per unit, artifacts and profiles in R2, the index in D1, and the site and API reading both. Why it is cheap to run."
updated: 2026-10-07
---

**carrier-explode** is three Cloudflare Workers over one R2 bucket and one D1 database. The **extractor** finds new builds and carrier files, extracts them into the bucket (`carrier-explode-ingest`) and indexes them into the database (`carrier-explode-index`). The **site** and the **API** only read.

## Flow

| Stage          | Runs in                           | Reads                               | Writes                                        |
| -------------- | --------------------------------- | ----------------------------------- | --------------------------------------------- |
| Feed check     | extractor, on a cron              | a feed; the bucket's held records   | one Workflow instance per new unit            |
| Unit           | a Workflow instance, step by step | the firmware or file, by HTTP Range | `obj/` artifacts, `norm/` profiles            |
| Release record | the unit's last step              | what the steps left in `tmp/`       | `releases/<platform>/…json`; an index message |
| Indexing       | the index queue's consumer        | records, profiles                   | D1 rows; a purge message                      |
| Purge          | the purge queue's consumer        |                                     | each reader's cache dropped                   |
| Pages, API     | site and API Workers              | D1 rows, R2 objects                 | nothing                                       |

A **unit** is the smallest thing ingested on its own: an iOS build, one Pixel's OTA of one build, one Galaxy firmware, or one snapshot of an OTA feed. Its Workflow instance is named after it (`galaxy-build-S942UOYN4BZID`), so it is never started twice. A unit is **held** once its record is in the bucket; planning compares a feed against R2 key listings, not D1. The record is written last, so a failed unit is planned again by the next check.

## Pipelines

From `apps/extractor/src/pipelines.ts`; times are UTC.

| Pipeline       | Unit                                       | Feed                                                             | Checked               | Article                                |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------- | --------------------- | -------------------------------------- |
| `ios-build`    | an iOS build: its in-scope IPSWs           | ipsw.me, AppleDB                                                 | every 20 minutes      | [Apple ingest](/wiki/pipeline/apple)   |
| `apple-ota`    | a snapshot of Apple's manifest             | the [carrier bundle manifest](/wiki/ios/carrier-bundle-manifest) | every 6 hours, at :07 | [Apple ingest](/wiki/pipeline/apple)   |
| `pixel-device` | one Pixel's OTA of one build               | Google's OTA page, source.android.com build numbers              | daily, 03:35          | [Pixel ingest](/wiki/pipeline/pixel)   |
| `pixel-ota`    | a snapshot of the update service's answers | Google's carrier settings update service                         | every 6 hours, at :07 | [Pixel ingest](/wiki/pipeline/pixel)   |
| `galaxy-build` | one model's firmware                       | Google Play's device list, Samsung `version.xml`, FUS            | every 20 minutes      | [Galaxy ingest](/wiki/pipeline/galaxy) |
| `labels`       | a week                                     | codes no feed names                                              | Mondays, 04:17        |                                        |
| `dataset`      | a day                                      | the public API                                                   | daily, 03:50          | [Datasets](/wiki/datasets)             |
| `reindex`      | a record, or every held record             | the bucket                                                       | by hand               | [Indexing](/wiki/pipeline/indexing)    |

A check starts every unit it plans at once, except that the two pipelines that need a container (`ios-build`, `galaxy-build`) start at most their share of the container pool: 3 and 1 of 5 in production; the spare covers a released container whose slot frees minutes later.

## Scope

Production scope, from `apps/extractor/wrangler.jsonc`:

| Family    | Devices                                                                                 | Before 5 October 2026                                                                                | From 5 October 2026 |
| --------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------- |
| iPhone    | released since September 2023                                                           | every release, and the newest major's betas                                                          | every build         |
| Pixel     | released since October 2020                                                             | each Pixel's newest build of each train                                                              | every build         |
| Galaxy    | US S, Z Fold and Z Flip (FE aside) launched since January 2025                          | each model's newest build of the newest 3 Android majors, on each family's newest generation with it | the same            |
| Apple OTA | iOS: every file; iPadOS, watchOS: each source's file for the newest OS it is listed for |                                                                                                      |                     |

## Failures

| What fails          | Then                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| a step              | retried 3 times, 10 s apart and doubling; a container step 2 times                                                        |
| a step, permanently | a 4xx other than 408 and 429, a record that fails its schema, or a format error: the instance stays errored until rebuilt |
| an index message    | retried 10 times, 5 minutes apart, then kept in a dead-letter queue                                                       |

## Running costs

| Design                                                                                                                                                                           | Where                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| The bulk of the data (artifacts, profiles) is in R2, written once under its hash; R2 does not charge for egress ([R2 pricing](https://developers.cloudflare.com/r2/pricing/))    | `obj/`, `norm/`; writes use `If-None-Match: *` |
| D1 holds an index, not the files: a source's full settings and concepts are kept for its newest version only; older versions are read from their profile in R2                   | `settings`, `concepts` tables                  |
| Worker steps read firmware by HTTP Range and stream it: a Pixel OTA's partitions are read from inside its `payload.bin`, a Galaxy member is decrypted and inflated as it arrives | `packages/firmware`                            |
| A step asks D1 which hashes are already held, in one query, and stores only the rest                                                                                             | `heldShas`, R2 listings                        |
| A container is used only where a Worker cannot do the job: an iOS root filesystem and a Galaxy `AP` member                                                                       | `apps/extractor/container`                     |
| Each container attempt gets its own container, which is destroyed when the job answers, at the latest after 58 minutes; an idle one stops after 5                                | `src/container.ts`                             |
| Derivation runs once per platform after a burst of units, not once per unit                                                                                                      | the index queue                                |
| Pages and API answers are cached at the edge and dropped only when the index changes                                                                                             | one cache tag, `index`                         |

The container instance type is 1 vCPU, 3 GiB, 20 GB, the smallest with the disk the Galaxy job needs.

## See also

- [Apple ingest](/wiki/pipeline/apple), [Pixel ingest](/wiki/pipeline/pixel), [Galaxy ingest](/wiki/pipeline/galaxy)
- [Profiles](/wiki/pipeline/profiles)
- [Indexing](/wiki/pipeline/indexing)
- [Storage and serving](/wiki/pipeline/serving)
- [About](/wiki/credits): the sources, credited
