---
title: Datasets
searchTitle: "carrier-explode dataset: carrier settings as a CC0 zip"
description: "The API's answers in one daily zip, in the public domain: every iPhone, iPad, Watch, Pixel and Galaxy carrier source at its head, decoded, with feature states per phone and Pixel and Galaxy settings in AOSP's XML."
updated: 2026-10-07
---

<script>
  import ApiUrl from "#lib/components/wiki/ApiUrl.svelte";
  import Dataset from "#lib/components/wiki/Dataset.svelte";
</script>

<Dataset />

The [API](/wiki/api)'s answers for every source's head, in one zip built daily. It changes only when its contents do; its `ETag` and SHA-256 say whether yours is current.

## What's in it

- Every carrier, country and default source of every platform the API lists, at its head: the version a phone reads when none is named, decoded into identity, APNs and concepts.
- Each source's carrier, lines and the SIM rules that select it.
- Feature states on every phone a held build lists; carriers, countries, devices, builds and concepts.
- Pixel APNs and CarrierConfig, and Galaxy APNs, in AOSP's XML.

No settings file is in it. Apple's native settings are not included.

## Layout

Each file under `v1/` is the API's answer at that path, the same JSON with the schema in <ApiUrl path="/openapi.json" />; a paged list holds every page's items. Pixel's files are under `v1/pixel/`, its API path `/v1/android/`.

| File                                                 | What                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `v1/carriers.json`, `v1/countries.json`              | Carriers, linked across platforms, and countries                              |
| `v1/concepts.json`, `v1/platforms.json`              | What a profile reads; each platform's kinds of source                         |
| `v1/devices.json`, `v1/devices/<code>/features.json` | Devices, and every source's feature states on each phone read                 |
| `v1/<platform>/builds.json`                          | iOS, Pixel and Galaxy builds                                                  |
| `v1/<platform>/<kind>.json`, `…/<name>.json`         | A platform's sources, and each one                                            |
| `…/<name>/versions/latest.json`                      | Its head, decoded: `?fields=apns,concepts,identity`                           |
| `pixel/apns-conf.xml`                                | Pixel APNs, in TelephonyProvider's format                                     |
| `pixel/carrier-config-list.xml`                      | Pixel CarrierConfig, as `carrier_config_list` in CarrierConfig's `vendor.xml` |
| `samsung/apns-conf.xml`                              | Galaxy APNs, in TelephonyProvider's format                                    |

## Provenance

A version's `entry.sha` is the SHA-256 of the settings file it was decoded from, and `shipped` lists each build and carrier update download that carried it. A concept's `because` names the native settings it was read from, with their values; an APN's `path` is where it sits in its file.

In the XML, an element repeats once per SIM rule of its source (`selectedBy`), as AOSP filters: `mcc`, `mnc`, then `mvno_type` in apns-conf.xml or `gid1`, `gid2`, `spn`, `imsi` in CarrierConfig. Rules a format cannot state are left out. `carrier-config-list.xml` opens with the Pixel's `default.pb`, unfiltered, as a Pixel reads it under each carrier's file. The zip's `README.md` has the details.

## License

The data is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): in the public domain, free to use for anything, without attribution. The site's code is MIT-licensed.
