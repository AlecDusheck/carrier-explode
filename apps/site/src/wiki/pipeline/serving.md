---
title: Storage and serving
searchTitle: "Storage and serving: R2 layout, D1, edge cache"
description: "What this site keeps in R2 and in D1, how the pages and the API read them per request, and how answers are cached at the edge and dropped when the index changes."
updated: 2026-10-07
---

**Storage** is one R2 bucket, `carrier-explode-ingest`, holding every file and normalized object, and one D1 database, `carrier-explode-index`, holding the index over them. The extractor alone writes both. **Serving** is two Workers that only read them: the site (SvelteKit) and the [API](/wiki/api) (Hono).

## R2

Every key is spelled in `packages/storage/src/keys.ts`.

| Key                                     | What                                                                                  | Written                   |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
| `obj/<sha256>`                          | an artifact's bytes: a bundle, a `.pb` file, a pack, a modem package or configuration | once                      |
| `norm/v8/<sha>.json`                    | a [profile](/wiki/pipeline/profiles)                                                  | once per `PROFILE_SCHEMA` |
| `norm/v8/<sha>.json`                    | a modem configuration                                                                 | once per `MODEM_SCHEMA`   |
| `norm/v8/combos/<key>.json`             | a band-combination list                                                               | once                      |
| `decoded/baseband/v<n>/<sha>.json`      | an iOS modem package's summary                                                        | once                      |
| `releases/<platform>/…json`             | a unit's release record: `ios/24A446.json`, `android/CP3A.260905.009/tokay.json`      | last, by its unit         |
| `ota/apple/manifests/<sha1>.plist`      | a manifest as fetched                                                                 | once                      |
| `ota/pixel/snapshots/<sha1>.json`       | a set of update service answers                                                       | once                      |
| `ota/<feed>/current.json`               | the snapshot a feed was last planned from                                             | per snapshot              |
| `ota/<feed>/files/<sha256 of URL>.json` | one OTA file's record: its hash, digests and every listing                            | per change                |
| `firmware/samsung/<build>.json`         | what FUS said of a Galaxy build: its Android version, build day and model name        | once                      |
| `tmp/<instance>/…`                      | hand-offs between a unit's steps                                                      | expired after a day       |

## D1

The schema is `packages/db/src/schema.ts`.

| Group      | Tables                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Facts      | `releases`, `copies`, `profiles`, `sims`, `routes`, `modems`, `modem_configs`, `ota_files`, `devices` |
| Per source | `entries`, `sources`, `settings`, `base_settings`, `concepts`, `phone_states`, `changes`              |
| Linking    | `carriers`, and `links`, the corrections people write                                                 |
| Names      | `labels`                                                                                              |

[Indexing](/wiki/pipeline/indexing) says what each holds. A carrier's countries, its platforms, how rare a setting is, and a carrier's modem configurations (`sims` joined to `modem_configs`) are computed in SQL per request. **Labels** fill in names no feed gives: a feed's own name first, then one a person wrote, then one a language model found on a page it read.

## Reading

| Reader | D1                               | R2                                                                                                                                         |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Site   | every list and page, per request | profiles and modem configurations from `norm/`, iOS modem summaries from `decoded/baseband/`; a file view decodes its artifact from `obj/` |
| API    | the same                         | profiles, modem configurations and band combinations from `norm/`                                                                          |

A file view shows the file decoded. The only bytes served as stored are the images and sounds Apple bundles carry, at `/raw/…`; a carrier logo in Apple's CgBI PNG form is converted to PNG first.

## Caching

| Answer                            | At the edge | In a browser         |
| --------------------------------- | ----------- | -------------------- |
| a named version, a redirect       | 30 days     | revalidated each use |
| a source's newest version, a list | 1 day       | revalidated each use |
| a 404                             | 60 seconds  | revalidated each use |
| a bundle's image or sound (site)  | 30 days     | 1 day                |

An edge answer may also be served stale for a day while it is fetched again.

Every cached answer carries one cache tag, `index`. When an index message writes anything, it queues a purge; the purge queue gathers up to 100 messages or 30 seconds and sends one purge of `index` to each reader.

An API answer also carries an `ETag`, so a repeat request can be a `304`. Requests are limited per IP address ([API § Rate limits](/wiki/api#rate-limits)).

## See also

- [How carrier-explode works](/wiki/pipeline/overview)
- [Indexing](/wiki/pipeline/indexing)
- [API](/wiki/api)
