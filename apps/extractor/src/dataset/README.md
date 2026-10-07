# carrier-explode dataset

The carrier settings Apple, Google and Samsung ship, decoded: the carrier-explode API's (`https://api.carrierexplode.com`) answers for every source's head, in one archive, and a Pixel's and a Galaxy's settings in AOSP's XML. Built daily; the archive changes only when its contents do.

## Layout

Each file under `v1/` is the API's answer at that path, the same JSON with the same schema (`/openapi.json`); a paged list holds every page's items, with `next` null.

| File                                               | API answer                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `v1/platforms.json`, `v1/concepts.json`            | `/v1/platforms`, `/v1/concepts`: platforms and their kinds of source; every concept a profile reads |
| `v1/carriers.json`, `v1/countries.json`            | `/v1/carriers`, `/v1/countries`                                                                     |
| `v1/devices.json`                                  | `/v1/devices`                                                                                       |
| `v1/devices/<code>/features.json`                  | `/v1/devices/<code>/features`: every source's feature states on that phone                          |
| `v1/<platform>/builds.json`                        | `/v1/<platform>/builds`: iOS, Pixel and Galaxy builds                                               |
| `v1/<platform>/<kind>.json`                        | `/v1/<platform>/<kind>`: one platform's sources of one kind                                         |
| `v1/<platform>/<kind>/<name>.json`                 | `/v1/<platform>/<kind>/<name>`: a source: its carrier, lines, the SIM rules that select it          |
| `v1/<platform>/<kind>/<name>/versions/latest.json` | `…/versions/latest?fields=apns,concepts,identity`: its head, decoded                                |
| `pixel/apns-conf.xml`                              | Pixel APNs in TelephonyProvider's format                                                            |
| `pixel/carrier-config-list.xml`                    | Pixel CarrierConfig in the `carrier_config_list` format of CarrierConfig's `vendor.xml`             |
| `samsung/apns-conf.xml`                            | Galaxy APNs in TelephonyProvider's format                                                           |

`<platform>` is `ios`, `ipados`, `watchos`, `pixel` or `samsung` (Galaxy); the API names Pixel `android`, so `v1/pixel/…` is its `/v1/android/…`; `<kind>` is `carriers`, `countries` or `defaults`. Names are the platform's own, percent-encoded as in the API's URLs.

## Scope

- Every source the API lists, at its head: the version a phone reads when none is named, its default line's newest non-beta.
- A head's identity, APNs and concepts. Apple's native settings are not included; a Pixel's and a Galaxy's are summarized in the XML only.
- Feature states on every phone a held build lists.
- No settings file is included.

## Provenance

- A version's `entry.sha` is the sha256 of the settings file it was decoded from; `shipped` lists every build and carrier update download that carried it.
- A concept's `because` lists the native settings it was read from (key path and value), and `fidelity` how directly.
- An APN's `path` is where it sits in its file.
- A Pixel element in the XML comes from the head's CarrierSettings file; a Galaxy APN from its CSC pack, decoded.

## AOSP XML

- An element repeats once per SIM rule its source's `selectedBy` lists, as `mcc` and `mnc`, plus `mvno_type` and `mvno_match_data` (apns-conf.xml) or `gid1`, `gid2`, `spn`, `imsi` (CarrierConfig). A rule the format cannot state is left out: an ICCID prefix in CarrierConfig, a GID2 or several qualifiers in apns-conf.xml, Apple's carrier IDs.
- CarrierConfig compares `gid1` exactly and reads `spn` and `imsi` as regular expressions; an IMSI rule is its prefix followed by `.*`. `name` is the source's name, which CarrierConfig ignores.
- `carrier-config-list.xml` opens with the Pixel's `default.pb`, unfiltered: each carrier's elements apply over it, as on a Pixel.
- An enum value newer than the decoder's proto has no AOSP name, and is left out.
- Galaxy APNs state no radio technologies.

## License

The data is dedicated to the public domain under CC0 1.0 Universal: see `LICENSE`. carrier-explode's code is MIT-licensed.
