---
title: API
searchTitle: "carrier-explode API: decoded carrier settings as JSON"
description: "The free JSON API over everything this site decodes: carriers across iPhone, Pixel and Galaxy, feature states per phone, SIM lookup, comparisons, every version and setting, builds and modem configurations."
updated: 2026-10-06
---

<script>
  import ApiUrl from "#lib/components/wiki/ApiUrl.svelte";
</script>

The API serves what this site shows as JSON, at no charge and without a key: <ApiUrl />. Start at <ApiUrl path="/v1" />, which lists every collection with an example; the OpenAPI 3.1 document is <ApiUrl path="/openapi.json" />.

## Two layers

- **Shared**: what is the same on every platform. Carriers, linked across platforms by the SIMs they claim; countries; concepts (VoLTE, 5G Standalone, Wi-Fi Calling…) and each carrier's feature states per phone; devices; SIM lookup; and comparisons of any two versions.
- **Per platform**: Apple's carrier and country bundles, with per-phone override files as variants and OTA downloads beside IPSW builds; a Pixel's CarrierSettings per device, read over its build's default.pb, routed by carrier_list.pb; a Galaxy's CSC/OMC packs per sales code, with its firmware's modem configurations, which no SIM selects.

## URLs

`<platform>` is `ios`, `ipados`, `watchos`, `android` (Pixel) or `samsung` (Galaxy); `<kind>` is `carriers`, `countries` (Apple only) or `defaults`. Sources keep their platform's own names: `ATT_US`, `att_us`, the sales code `ATT`.

| Route                                                           | What                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `/v1`, `/v1/platforms`, `/v1/concepts`                          | What the API covers                                                         |
| `/v1/carriers`, `/v1/carriers/<id>`                             | Carriers (`?q=` any of their names, `?country=`, `?platform=`)              |
| `/v1/carriers/<id>/features`, `…/profiles`, `…/modems`          | Its feature states per phone, its sources decoded, its modem configs        |
| `/v1/countries`, `/v1/countries/<iso>`                          | Countries                                                                   |
| `/v1/features/<feature>`                                        | Every carrier's state of one feature (`?country=`, `?device=`, `?state=`)   |
| `/v1/devices`, `/v1/devices/<code>`                             | iPhones, Pixels and Galaxies                                                |
| `/v1/devices/<code>/features`, `…/modems`                       | Each carrier's features on it, and the modems its build ships               |
| `/v1/sims?mccmnc=…&gid1=…`                                      | Every source a SIM selects, most specific rule first                        |
| `/v1/compare?a=<source>&b=<source>`                             | Two versions: concepts and APNs, and native settings within a family        |
| `/v1/<platform>/<kind>`, `…/<name>`                             | A platform's sources; one with its lines and the SIM rules selecting it     |
| `/v1/<platform>/<kind>/<name>/versions`, `…/versions/<version>` | Its versions, and one decoded with every build and download that shipped it |
| `…/versions/<version>/settings`                                 | Every native setting (`?prefix=`)                                           |
| `/v1/<platform>/builds`, `…/builds/<build>`                     | Builds (`ios`, `android`, `samsung`; `?version=`, `?device=`)               |
| `…/builds/<build>/changes`, `…/builds/<build>/modems`           | What a build changed (each change links its comparison), and its modems     |
| `/v1/modem-configs/<sha>`, `/v1/combos/<key>`                   | A modem configuration, and its band combinations                            |

`<version>` is a slug from the versions list (`72.0`, `64.1@23a341`) or `latest`. Android and Galaxy files differ per device, so a version is on a device's line: `?line=tokay`, the newest device by default. A model-specific Apple bundle's line is its product type. A `<source>` in a query is `<platform>:<kind>:<name>`.

## Paging and fields

A list answers a page at a time, `limit` items (100 by default, at most 500), with `next` naming the next page: follow `next.url`, or pass `next.cursor` as `cursor`. `next` is null on the last page. A version and a carrier's profiles take `fields=apns,concepts` (also `identity`, `variants`) to answer only those.

A query has one spelling: parameters in order, defaults left out. Another spelling redirects to it, and an unknown parameter is an error. An error is JSON too: `error.status`, `error.code` (`bad_request`, `not_found`, `rate_limited`, `internal`) and `error.message`.

## Caching

Answers are cached at the edge until the index changes, which drops them. A version named by its slug, a modem configuration, and a comparison of two named versions never change; `latest` follows the line. Answers carry an `ETag`, so a repeat request can be a `304`.

## Rate limits

**300** requests per IP address in 10 seconds, counted together with this site's and at each Cloudflare location. Answers from the cache do not count. Past it, Cloudflare answers `429` with `Retry-After` and its own error page, not the JSON error shape, for 10 seconds.

Please be respectful, and send a `User-Agent` that names your product. If you intend to use the service at high volume, please [contact](/wiki/credits#contact) Alec at `<alec> @ simplyalec.com` first.

## Examples

- `/v1/carriers?q=verizon`, then `/v1/carriers/<id>/features?feature=volte`: one carrier's VoLTE on each platform's newest phone.
- `/v1/features/5g-standalone?country=jp&state=on`: the carriers in Japan that give 5G Standalone.
- `/v1/carriers/ATT_US/profiles?fields=apns`: AT&T's APNs on every platform.
- `/v1/ios/builds?version=27.2`, then `/v1/ios/builds/<build>/changes?carrier=<id>`: what one iOS release changed for a carrier.
- `/v1/devices/<code>/modems`: the modem firmware a phone's newest build ships, and its configurations.
- `/v1/sims?gid1=6D38&mccmnc=310260`: which sources select that SIM.
