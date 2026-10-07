---
title: T-Mobile US
searchTitle: "T-Mobile US iPhone carrier bundle: settings, quirks"
description: "What is unusual in T-Mobile's iOS carrier bundle: 35 SIM ranges, IoT MVNOs, a lab server in production, text-to-911 test numbers and QuickSwitch."
updated: 2026-10-02
category: carrier
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
</script>

T-Mobile's main bundle in the US is <Bundle name="TMobile_US" version />. It is one of the largest carrier bundles, and the only one with modem files for MVNOs.

## Bundles

| Bundle                                                                    |                                 |
| ------------------------------------------------------------------------- | ------------------------------- |
| <Bundle name="TMobile_US" />                                              | T-Mobile, Metro by T-Mobile ??? |
| <Bundle name="TMobile_MVNO_US" />, <Bundle name="TMobile_Wholesale_US" /> | MVNOs without their own bundle  |
| <Bundle name="TMobile_Comcast_US" />                                      | Xfinity Mobile                  |
| <Bundle name="TMobile_Charter_US" />                                      | Spectrum Mobile                 |
| <Bundle name="TMobile_UltraMint_US" />                                    | Ultra Mobile / Mint ???         |
| <Bundle name="TMobile_Boost_US" />                                        | Boost                           |
| <Bundle name="TMobile_Vodafone_US" />                                     | ???                             |

Xfinity and Spectrum have one bundle on Verizon and one on T-Mobile each.

## SIM matching

`TMobile_US` lists 35 `SupportedSIMs`: 14 plain MCC+MNCs (`310160`, `310200` to `310270`, `310310`, `310490`, `310660`, `310800`, `311660`, `311882`), GID1 `54` on `310240` and `310260`, and 20 ICCID blocks under `310260` (`310260_ID-89012600` and on).

## MVNO configurations

`TMobile_US` has three `MVNOOverrides`:

| SIMs     | Changes                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `311660` | attach APN `iot.t-mobile.com`, software updates opt-in, no carrier services menu, no My Account                                              |
| `311882` | the same                                                                                                                                     |
| `310310` | Wi-Fi Calling without entitlement, ePDG `epdg.epc.mnc310.mcc310.pub.3gppnetwork.org`, entitlement server `https://eas3.msg.lab.t-mobile.com` |

So SIMs on `311660` (MetroPCS's old range) and `311882` attach with an IoT APN, and SIMs on `310310` are sent to an entitlement server with `lab` in its name. Who uses those ranges today is ???.

It is also the only bundle with per-MVNO modem files: `overrides_mvno1_*.der.pri`, one for each phone group, next to the normal ones. Which configuration uses them is ???.

## Emergency calls

`EmergencyCalling.EmergencyNumbers`:

```
911     voice and text, preferred
922     text only, TestNumber
933     text only, TestNumber
```

933 is the US number for testing a 911 address. Only `TMobile_US` and `TMobile_Comcast_US` mark numbers as `TestNumber`.

`IMSConfig.Signaling.CallEndReasons` has three emergency-specific reasons no other bundle has: `EmergencySetupTimeout` (`Call-setup time-out`), `EmergencyUserTriggered` (`User ends call`) and `EmergencyUserTriggeredTimeout` (`User ends call and SIP response time-out`).

## QuickSwitch

Only `TMobile_US` and `TMobile_Germany` have a `QuickSwitch` dictionary:

```
SMSForkingMechanism                     3
AllowiPhoneTransferOfSecondaryAccount   true    (TMobile_US only)
SecondaryAccountReturnsAllDevices       true
WatchHandling                           3
```

and `CarrierEntitlements.SupportsQuickSwitchSetActiveIccid`. This looks like moving a line between devices without a new SIM. ???

## Other

- `IMSConfig.EnableThumperByDefault` is true only here and in `Sprint_CSIM_LTE_US`. Thumper is ???.
- `CarrierAppDiscoverability.AllowCarrierSpaceApp` is only in `TMobile_US` and `Free_fr`.
- `PushSettings.PreferredNetworksTopic` is `com.t-mobile.msg.eas`.

## See also

- [AT&T](/wiki/ios/att), [Verizon](/wiki/ios/verizon)
- [.der.pri § MVNO files](/wiki/ios/der-pri#mvno-files)
