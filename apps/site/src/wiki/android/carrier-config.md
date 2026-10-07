---
title: CarrierConfig and APNs
searchTitle: "Pixel carrier .pb files: CarrierConfig keys and APNs"
description: "What is inside a Pixel carrier settings file: CarrierConfigManager keys and their value types, the APN list, vendor configs, and fields AOSP's proto lacks."
updated: 2026-10-04
---

Each file in [CarrierSettings](/wiki/android/carrier-settings) other than `carrier_list.pb` is a `CarrierSettings` message (AOSP's `carrier_settings.proto`), and `others.pb` is a `MultiCarrierSettings` holding many of them. A file holds only what it sets: a key it leaves out is not there, which is different from a key set to its default.

| Field              | What                                                    |
| ------------------ | ------------------------------------------------------- |
| 1 `canonical_name` | `tmobile_us`; the file is named after it                |
| 2 `version`        | see [Versions](/wiki/android/carrier-settings#versions) |
| 3 `apns`           | the carrier's APNs                                      |
| 4 `configs`        | CarrierConfig keys and values                           |
| 6 `vendor_configs` | opaque blobs, one per vendor client                     |

Field 5 is reserved in AOSP's proto. The Pixel 9's `tmobile_us.pb`, `default.pb` and `no_sim.pb` also have a field 8, which the proto lacks ???. `MultiCarrierSettings` is a `version` (1) and repeated `setting` (2).

## Configs

A config is a key and one value, which is text, an int32, an int64, a bool, a double, an array of text, an array of int32, or a bundle of further configs.

The keys are the string values of Android's `CarrierConfigManager` constants: `KEY_CARRIER_VOLTE_AVAILABLE_BOOL` is `carrier_volte_available_bool`. The suffix names the value type. Keys of the nested classes carry the class's prefix: `ims.`, `imsvoice.`, `imsss.`, `iwlan.`, `qns.` and others. Most MMS keys are camel-case instead (`maxMessageSize` is `KEY_MMS_MAX_MESSAGE_SIZE_INT`).

From `CP3A.260905.009`:

| File                             | Keys | Bundles |
| -------------------------------- | ---- | ------- |
| `tmobile_us.pb` (Pixel 9)        | 156  | 5       |
| `default.pb` (Pixel 9)           | 88   | 4       |
| `no_sim.pb` (Pixel 9)            | 81   | 4       |
| `others.pb` part `20404SPN=JUMP` | 5    | 0       |

`tmobile_us.pb` sets, among others:

| Key                                   | Value    |
| ------------------------------------- | -------- |
| `carrier_volte_available_bool`        | `true`   |
| `carrier_wfc_ims_available_bool`      | `true`   |
| `vonr_enabled_bool`                   | `true`   |
| `carrier_nr_availabilities_int_array` | `[1, 2]` |

The settings view explains each key with its AOSP javadoc, read from `CarrierConfigManager.java` at every release from Android 10 to 17 and from the QNS and IWLAN services' own config classes: [tmobile_us settings](/android/carriers/tmobile_us/tokay/79000000034/settings).

Not every key is in those classes. `tmobile_us.pb` has 5 that none defines (`display_hd_plus_icon_bool`, `iwlan.derive_nai_from_imsi_bool`), `default.pb` 12 (`gps.longterm_psds_server_1`, `qns.support_wfc_recovery_bool`), and `no_sim.pb` 5 (`rilext.pcscf_reselection_support`, `vendor.ims.carrier_config_use_aosp_ims_config_bool`). What they do is ???.

## APNs

An APN is an `ApnItem`. It has no MCC-MNC or MVNO fields: the proto's comment says those "define a carrier", and that is [carrier_list.pb](/wiki/android/carrier-list)'s job.

| Field                                 | What                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1 `name`                              | the name shown in Settings (`T-Mobile US`)                                                                                               |
| 2 `value`                             | the APN itself (`fast.t-mobile.com`)                                                                                                     |
| 3 `type`                              | repeated: `ALL`, `DEFAULT`, `MMS`, `SUPL`, `DUN`, `HIPRI`, `FOTA`, `IMS`, `CBS`, `IA` (initial attach), `EMERGENCY`, `XCAP`, `UT`, `RCS` |
| 4 `bearer_bitmask`                    | network types the APN is for, as `TelephonyManager.NETWORK_TYPE_*` numbers joined by vertical bars; `0` for all                          |
| 5-9                                   | server, proxy, port, user, password                                                                                                      |
| 10 `authtype`                         |                                                                                                                                          |
| 11-13                                 | MMSC, MMS proxy and port                                                                                                                 |
| 14 `protocol`, 15 `roaming_protocol`  | `IP`, `IPV6`, `IPV4V6` or `PPP`                                                                                                          |
| 16 `mtu`                              |                                                                                                                                          |
| 17 `profile_id`                       | an ID used to sync the APN with the modem                                                                                                |
| 18-20                                 | connection limits                                                                                                                        |
| 22 `modem_cognitive`                  | whether the APN is persisted to the modem                                                                                                |
| 23 `user_visible`, 24 `user_editable` | whether Settings shows it, and lets it be changed                                                                                        |
| 25 `apn_set_id`                       | APNs of one set are preferred together                                                                                                   |
| 26 `skip_464xlat`                     |                                                                                                                                          |

`tmobile_us.pb` on the Pixel 9 has five:

| Name               | APN                 | Types                                  | Protocol                 |
| ------------------ | ------------------- | -------------------------------------- | ------------------------ |
| T-Mobile Tethering | `pcweb.tmobile.com` | `DUN`                                  | `IPV6`                   |
| T-Mobile US        | `fast.t-mobile.com` | `DEFAULT`, `SUPL`, `IA`, `MMS`, `XCAP` | `IPV6`, MTU 1440         |
| T-Mobile US IMS    | `ims`               | `IMS`                                  | `IPV6`, `IPV4V6` roaming |
| T-Mobile MMS       | `TMUS`              | `MMS`, `XCAP`                          | `IPV6`                   |
| T-Mobile Emergency | `sos`               | `EMERGENCY`                            | `IPV6`, `IPV4V6` roaming |

Three of the five also carry a field 28 or 30, past the proto's last field (26) ???. See [tmobile_us APNs](/android/carriers/tmobile_us/tokay/79000000034/apns).

## Vendor configs

A `VendorConfigClient` is a name and a blob whose format "depends on the specific client", in the proto's words. `tmobile_us.pb` has one client, `rcs`; `default.pb` and `no_sim.pb` have `ril`. Their formats are not public ???.

## See also

- [CarrierSettings](/wiki/android/carrier-settings)
- [Carrier.plist](/wiki/ios/carrier-plist): the iOS counterpart
