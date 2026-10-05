---
title: API
searchTitle: "carrier-explode API: decoded carrier settings as JSON"
description: "The free JSON API over everything this site decodes: sources and their versions, every setting, APNs, features per phone, builds, carriers and Pixel modem configurations."
updated: 2026-10-04
---

<script>
  import ApiUrl from "#lib/components/wiki/ApiUrl.svelte";
</script>

The API serves what this site shows as JSON, at no charge and without a key: <ApiUrl />. Its OpenAPI 3.1 document is <ApiUrl path="/openapi.json" />.

## What it serves

- A **version** in the platform-neutral model: the SIMs that select it, its APNs (a password only as `hasPassword`), and its concepts, such as whether VoLTE is on, each with the native settings it was read from.
- A version's **settings**: every native key decoded, by path (`carrier.plist:SupportsVoLTE`, `config:carrier_volte_available_bool`).
- **Features** per phone: on, available, or no, for every carrier source of the current build.
- **Builds**, what each changed, and the modems each ships; Pixel **modem configurations** decoded, and their band combinations.
- **Carriers** across platforms, linked by the SIMs they claim, and **countries**.

## URLs

Every route is under `/v1`, platform first, as on this site. `<platform>` is `ios`, `ipados`, `watchos` or `android`; `<kind>` is `carriers`, `countries` (Apple only) or `defaults`.

| Route | What |
|-------|------|
| `/v1/platforms`, `/v1/features` | What the API covers |
| `/v1/<platform>/<kind>` | A platform's sources |
| `/v1/<platform>/<kind>/<name>` | A source and its lines |
| `/v1/<platform>/<kind>/<name>/versions` | A line's versions, newest first |
| `/v1/<platform>/<kind>/<name>/<version>` | A version, decoded |
| `/v1/<platform>/<kind>/<name>/<version>/settings` | Its native settings |
| `/v1/android/<kind>/<name>/<version>/modems` | The modem configurations its SIMs select |
| `/v1/<platform>/builds`, `…/builds/<build>` | Builds (`ios`, `android`) |
| `…/builds/<build>/changes`, `…/builds/<build>/modems` | What a build changed, and its modems |
| `/v1/<platform>/phones`, `…/phones/<device>/features` | The current build's phones, and each carrier's features on one |
| `/v1/carriers`, `/v1/carriers/<id>` | Carriers |
| `/v1/countries`, `/v1/countries/<iso>` | Countries |
| `/v1/android/modem-configs/<sha>`, `/v1/android/combos/<key>` | A modem configuration, and its band combinations |

`<version>` is a slug from the versions list (`72.0`, `64.1@23a341`) or `latest`. Android settings differ per Pixel, so a version is on a device's line: `?line=tokay`, the newest Pixel by default. A model-specific Apple bundle's line is its product type.

## Paging

A list answers a page at a time, `limit` items (100 by default, at most 500), with `next` naming the next page: follow `next.url`, or pass `next.cursor` as `cursor`. `next` is null on the last page.

A query has one spelling: parameters in order, defaults left out. Another spelling redirects to it, and an unknown parameter is an error. An error is JSON too: `error.status` and `error.message`.

## Caching

Answers are cached at the edge until the next index is published, which drops the ones it changes. A version named by its slug never changes; `latest` follows the line. Answers carry an `ETag`, so a repeat request can be a `304`.

## Rate limits

Per IP address, per minute, shared with this site, and counted at each Cloudflare location:

- **120** requests to the index: lists, sources, builds, phones, carriers, countries.
- **60** requests that read a decoded record: a version, its settings, a build's modems, a modem configuration or its band combinations.

An answer from the cache does not count. Past a limit, the API answers `429` with `Retry-After`.

Please be respectful, and send a `User-Agent` that names your product. If you intend to use the service at high volume, please [contact](/wiki/credits#contact) Alec at `<alec> @ simplyalec.com` first.

## Examples

- `/v1/ios/carriers?limit=50`: the first 50 iPhone carrier bundles.
- `/v1/ios/carriers/ATT_US/latest`: AT&T's newest iPhone bundle, decoded.
- `/v1/android/carriers/tmobile_us/latest/settings?line=tokay`: every CarrierSettings key T-Mobile's file sets on one Pixel.
- `/v1/ios/phones/iPhone18,1/features`: each carrier's features on one iPhone.
