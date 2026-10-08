# Public API (`/v1`)

`apps/api`: read-only JSON over the D1 index and the decoded records in R2. No key; the zone's per-IP rate limit covers it and the site. Everything a response states comes from `packages/db` reads (labels joined in SQL) and the stored records; the API derives nothing.

Two layers:

- **Shared**: what is the same on every platform: carriers (linked across platforms by SIM rules), countries, concepts and feature states, devices, SIM lookup, comparison.
- **Per platform**: each platform's own model, never forced into another's: sources and their versions, builds, modems.

| Platform  | Brand          | Sources (`<kind>`)                                                                                                   | Versions are on                                                    | Builds and modems                                                                          |
| --------- | -------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `ios`     | iPhone         | `carriers`, `countries`, `defaults`: bundles; per-phone override files are `variants` selected by board              | the main line `""`, or a model-specific bundle's product type line | IPSW builds; OTA files ship versions too (`shipped`); `modems`: baseband firmware packages |
| `ipados`  | iPad           | as iOS                                                                                                               | as iOS                                                             | none: OTA files only                                                                       |
| `watchos` | Apple Watch    | as iOS                                                                                                               | as iOS                                                             | none: OTA files only                                                                       |
| `android` | Google Pixel   | `carriers` (CarrierSettings, including `others.pb`'s rule-named parts), `defaults` (`default`: default.pb, `no_sim`) | each Pixel's codename                                              | builds per device and train; `modems`: firmware with its carrier configurations            |
| `samsung` | Samsung Galaxy | `carriers`: CSC/OMC packs by sales code (`ATT`)                                                                      | each Galaxy model number                                           | multi-CSC firmware per model; `modems`: the firmware's MCFG configurations                 |

SIM routing is per platform and stays so: Apple's OTA manifest and a Pixel's `carrier_list.pb` route SIMs to sources (`selectedBy.routed`); a source's own file claims SIMs (`selectedBy.claimed`); a Galaxy's modem configurations select no SIM, so they are listed by firmware and never by carrier.

## Identifiers

| Thing        | Identifier                                                                                                  | Example                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Carrier      | `id`: linked across platforms, its primary source's native name                                             | `ATT_US`                                             |
| Source       | platform + kind + native name in paths; `<platform>:<kind>:<name>` as a key                                 | `/v1/samsung/carriers/ATT`, `android:carrier:att_us` |
| Version      | slug on a line; `latest` is the line's newest non-beta                                                      | `72.1`, `64.1@23a341`, `latest`                      |
| Line         | `line=`: an Android/Galaxy device code or an Apple model; default: the newest device (Apple: the main line) | `?line=tokay`                                        |
| Device       | code, unique across platforms                                                                               | `iPhone18,1`, `tokay`, `SM-S948U`                    |
| Build        | platform + native id                                                                                        | `/v1/ios/builds/24C55`                               |
| Modem config | content sha256                                                                                              | `/v1/modem-configs/<sha>`                            |

Native names are never translated: an agent holding `att_us` or the sales code `ATT` finds the carrier with `/v1/carriers?q=att_us`; every source names its `carrier`.

## Resources

```
GET /v1                                           index: every collection, with an example
GET /v1/platforms                                 platforms, their kinds, whether they have builds
GET /v1/concepts                                  every concept a profile reads, its type and unit; features are the `state` ones

GET /v1/carriers                ?q ?country ?platform       paged
GET /v1/carriers/{id}                                       its sources, each with its head version
GET /v1/carriers/{id}/features  ?feature ?device            each source's feature states, on each platform's newest phone or the one named
GET /v1/carriers/{id}/profiles  ?fields                     each source's head, decoded (identity, apns, concepts, variants)
GET /v1/carriers/{id}/modems                                Pixel and Galaxy modem configurations its SIMs select, from each device's newest build that ships a modem
GET /v1/countries, /v1/countries/{iso}
GET /v1/features/{feature}      ?device ?platform ?country ?state   paged: every carrier source's state
GET /v1/devices                 ?platform ?q                paged
GET /v1/devices/{code}                                      with its newest build
GET /v1/devices/{code}/features                             paged: every carrier source's states on it
GET /v1/devices/{code}/modems   ?build                      the modems its build ships for it
GET /v1/sims                    ?mccmnc ?gid1 ?gid2 ?spn ?imsi ?iccid   every source a SIM selects
GET /v1/compare                 ?a ?a_line ?a_version ?b ?b_line ?b_version   concepts, APNs, and native settings within one family

GET /v1/{platform}/{kind}       ?q ?country                 paged
GET /v1/{platform}/{kind}/{name}                            carrier, lines, selectedBy, base layer
GET /v1/{platform}/{kind}/{name}/versions                   ?line   paged, newest first
GET /v1/{platform}/{kind}/{name}/versions/{version}         ?line ?fields   decoded, with what shipped it
GET /v1/{platform}/{kind}/{name}/versions/{version}/settings ?line ?prefix  every native setting
GET /v1/{platform}/builds       ?version ?device            paged, newest first (ios, android, samsung)
GET /v1/{platform}/builds/{build}
GET /v1/{platform}/builds/{build}/changes ?carrier          paged; each change links its comparison
GET /v1/{platform}/builds/{build}/modems                    ios: baseband packages; android, samsung: firmware and configurations, once per set of devices carrying the same ones
GET /v1/modem-configs/{sha}, /v1/combos/{key}               content-addressed, never change
```

## The questions, answered

Values below show shapes, not data: names, codes and states are placeholders.

**What does Verizon set for VoLTE on the newest iPhone vs Pixel vs Galaxy?**

```
GET /v1/carriers?q=verizon                       → items[0].id = "Verizon_US"
GET /v1/carriers/Verizon_US/features?feature=volte
{ "items": [
  { "source": "ios:carrier:Verizon_US", "device": { "code": "iPhone18,1", "name": "…" }, "states": { "volte": "on" }, "defaults": {} },
  { "source": "android:carrier:verizon_us", "device": { "code": "tokay", … }, "states": { "volte": "on" }, "defaults": {} },
  { "source": "samsung:carrier:<sales code>", "device": { "code": "SM-S948U", … }, "states": { "volte": "on" }, "defaults": { "volte": { "layer": "imsservice", "part": "rest" } } } ] }
```

**What changed for T-Mobile in iOS 27.2?**

```
GET /v1/ios/builds?version=27.2                   → items: [{ "id": "24C55", … }]
GET /v1/ios/builds/24C55/changes?carrier=TMobile_US
{ "items": [ { "source": "ios:carrier:TMobile_US", "kind": "changed",
    "from": { "line": "", "slug": "50.0", "version": "50.0" }, "to": { "line": "", "slug": "50.1", "version": "50.1" },
    "compare": "https://api…/v1/compare?a=ios:carrier:TMobile_US&a_version=50.0&b=…&b_version=50.1" } ], "next": null }
GET <compare>                                     → concept rows that differ, APN rows, native setting rows
```

**Which carriers in Japan enable 5G SA?**

```
GET /v1/features/5g-standalone?country=jp&state=on
{ "feature": "5g-standalone",
  "devices": [ { "code": "iPhone18,1", "platform": "ios", … }, { "code": "tokay", "platform": "android", … }, … ],
  "items": [ { "source": "ios:carrier:<name>_jp", "carrier": { "id": "<id>", "name": "…" }, "device": "iPhone18,1", "state": "on", "defaulted": null } ],
  "next": null }
```

States are per phone, so the answer names its phones: each platform's newest that reads states, or `?device=`.

**AT&T's APNs on each platform**: `GET /v1/carriers/ATT_US/profiles?fields=apns` → one item per source (`source`, `line`, `slug`, `version`, `profile.apns`; Apple's MVNO and per-phone `variants` with `fields=apns,variants`).

**Which modem firmware does the Galaxy S26 ship, and what configurations?**

```
GET /v1/devices?q=Galaxy%20S26                   → items[0].code = "SM-S948U"
GET /v1/devices/SM-S948U/modems
{ "device": "SM-S948U", "build": "S948USQS4AZHL", "platform": "samsung",
  "modems": [ { "name": "<firmware>", "family": "qualcomm", "familyName": "…", "configs": [ { "label": "<MCFG label>", "sha": "…" } ] } ] }
GET /v1/modem-configs/<sha>                       → items, facts, base, band-combination lists
```

**Find the carrier for SIM 310260, GID1 6D38**

```
GET /v1/sims?gid1=6D38&mccmnc=310260
{ "items": [
  { "source": "android:carrier:<mvno>", "carrier": { "id": "<id>", "name": "…" }, "rule": "310260|gid1=6D38", "via": "routed" },
  { "source": "ios:carrier:TMobile_US", "carrier": { "id": "TMobile_US", "name": "…" }, "rule": "310260", "via": "claimed" }, … ] }
```

Every rule the SIM satisfies, most specific first: a GID or IMSI/ICCID prefix rule only matches a SIM that states one.

## Conventions

- **Pages**: `limit` (100, at most 500) and an opaque `cursor`; `next` is `{ cursor, url }` or null. Keyset, so a page costs its size.
- **One spelling**: parameters sorted, the default limit left out; any other spelling is a 308 to it, an unknown parameter a 400. One URL, one cache entry.
- **Field selection**: `fields=apns,concepts` on a version and on a carrier's profiles; `settings` is its own resource, so a version never carries every native key.
- **Errors**: `{ "error": { "status": 404, "code": "not_found", "message": "No carrier Nope." } }`; codes `bad_request`, `not_found`, `internal`.
- **Caching**: everything is edge-cached until the next index purge (one tag, `index`). A version by slug, a modem config, and a comparison of two named versions are pinned (30 days); `latest` and lists 1 day, stale-while-revalidate. Every answer has an ETag; `If-None-Match` gets a 304.
- **Rate limit**: a zone WAF rule against floods, 300 requests per IP per 10 seconds across the site and the API (the site's static files excepted: `/_app/immutable/`, its SVGs outside `/raw/`, and `/cdn-cgi/`), counted per Cloudflare location; cache hits do not count (`requests_to_origin`). Past it, Cloudflare's own `429` page with `Retry-After` for 10 seconds, not the JSON error shape.
- **Discovery**: `/v1` lists every collection; `/openapi.json` (3.1) has every route, parameter, example and response schema; the site's `/llms.txt` and wiki article point here.

## Changed from the first `/v1`

| Before                                                           | Now                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `/v1/{platform}/{kind}/{name}/{version}`, `…/{version}/settings` | `…/{name}/versions/{version}`, `…/versions/{version}/settings` |
| `/v1/{platform}/phones`, `…/phones/{device}/features`            | `/v1/devices?platform=`, `/v1/devices/{code}/features`         |
| `/v1/features` (feature list)                                    | `/v1/concepts` (every concept; features are its `state` ones)  |
| `/v1/carriers/{id}` `modems`, `members`                          | `/v1/carriers/{id}/modems`; `sources`, each with its head      |
| `/v1/android/modem-configs/{sha}`, `/v1/android/combos/{key}`    | `/v1/modem-configs/{sha}`, `/v1/combos/{key}`: Galaxy's too    |
| builds' `sortKey`                                                | gone: the cursor carries it                                    |
| `error: { status, message }`                                     | adds `code`                                                    |

New: `/v1`, carrier features and profiles, `/v1/features/{feature}`, `/v1/devices/{code}`, device modems, `/v1/sims`, `/v1/compare`, list filters (`q`, `country`, `platform`, `version`, `device`, `carrier`, `state`), a source's `selectedBy` and `base`, a version's `shipped`, settings `prefix`.
