---
title: carrier_list.pb
searchTitle: "carrier_list.pb: how Pixels match a SIM to a carrier"
description: "The CarrierList protobuf in a Pixel's CarrierSettings: MCC-MNC rules, MVNO rules by GID1, SPN or IMSI prefix, the order they are read in, and its oddities."
updated: 2026-10-04
---

**carrier_list.pb** is the file in [CarrierSettings](/wiki/android/carrier-settings) that maps a SIM to a carrier's canonical name, and so to the `<canonical name>.pb` that configures it. Every Pixel in a build has the same one.

## Format

A `CarrierList` (AOSP's `carrier_list.proto`):

| Message       | Field                       | What                                                                                      |
| ------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `CarrierList` | 1 `entry`                   | repeated `CarrierMap`                                                                     |
|               | 2 `version`                 | int64, built like the [settings files' versions](/wiki/android/carrier-settings#versions) |
| `CarrierMap`  | 1 `canonical_name`          | `tmobile_us`                                                                              |
|               | 2 `carrier_id`              | repeated `CarrierId`                                                                      |
| `CarrierId`   | 1 `mcc_mnc`                 | 5 or 6 digits                                                                             |
|               | 2 `spn`, 3 `imsi`, 4 `gid1` | at most one of these: the service provider name, an IMSI prefix pattern, or a GID1 prefix |

A `CarrierId` with only an MCC-MNC is a network operator's rule: any SIM of that network. One with an SPN, IMSI or GID1 picks out an MVNO on that network. GID2 and ICCID are not in the proto; AOSP's converter refuses a `gid2` rule outright.

## Order

`CP3A.260905.009` has version `79000000590`, 3,486 entries and 1,319 canonical names. Every entry holds exactly one `CarrierId`, so a carrier with several rules has several entries:

| Rule         | Entries |
| ------------ | ------- |
| MCC-MNC only | 2,452   |
| GID1         | 664     |
| SPN          | 264     |
| IMSI         | 106     |

The entries are sorted by MCC-MNC, and within one MCC-MNC the MVNO rules come before the operator's. Some MCC-MNCs have no operator rule: `21404` has 19 SPN rules and one [field-6 entry](#oddities). AOSP's `GenCarrierList` writes the list that way "so that when matching a CarrierId against this list, the first match is always the best guess of carrier name". How Pixel's own code matches a SIM against it is not public ???.

`310260`, T-Mobile US, has 73 entries for 39 carriers. All but the last are MVNO rules (`metropcs_us` is GID1 `6D38`, `fi_tmo_us` is GID1 `4276` or IMSI `31026097`); the last is `tmobile_us` itself, with no MVNO rule.

### IMSI patterns

Most IMSI rules are plain prefixes (`31026097`). Some have an `x` in them: `302720x84` for `chatr_ca`, `248010x2` for `send_ee`, presumably any digit ???.

### Oddities

- `default` has MCC-MNC `000000`, the value AOSP's converter gives configs that apply to every carrier.
- `no_sim` is not in the list at all.
- `cspire_nl` has the SPN `C Spire` twice under `20404`, once with a carriage return on the end.
- Five entries (`1and1_de`, `legos_fr`, `xfera_es`, `b1_ch` and `megacom_kg`) carry a field 6 that AOSP's proto does not have; its own proto reserves field 5. The values are digit strings starting with `89` (`894936` for `1and1_de`), which is how an ICCID starts, so possibly an ICCID prefix ???. Each sits among its MCC-MNC's MVNO rules, not at the end where the operator's rule goes.
- The list itself has a field 4 that AOSP's proto lacks ???.

## Not AOSP's carrier ID list

AOSP has a carrier list of its own: TelephonyProvider's `assets/latest_carrier_id/carrier_list.textpb`, which gives carriers numeric IDs (`CarrierIdProto`). AOSP's converter reads it to find which of AOSP's XML configs apply to each carrier. It is a different message from this file's.

## On this site

A carrier's page shows the rules `carrier_list.pb` gives it: [tmobile_us](/android/carriers/tmobile_us).

The modem picks its own configuration from the SIM with tables of its own; see [Pixel modem configuration](/wiki/android/pixel-modem).

## See also

- [CarrierSettings](/wiki/android/carrier-settings)
- [Bundle Selection](/wiki/ios/bundle-selection): how iOS does the same
