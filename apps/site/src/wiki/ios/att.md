---
title: AT&T
searchTitle: "AT&T iPhone carrier bundle: settings and quirks"
description: "What is unusual in AT&T's iOS carrier bundle (ATT_US): its sub-brands, per-phone modem files, a Wi-Fi secret unchanged since 2009, and fast eSIM polling."
updated: 2026-10-02
category: carrier
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
  import Setting from "#lib/components/wiki/Setting.svelte";
</script>

AT&T's main bundle is <Bundle name="ATT_US" version />. It is one of the oldest bundles in the [manifest](/wiki/ios/carrier-bundle-manifest): `ATT_US.ipcc` 3.1 from February 2009 is the oldest file Apple still lists.

## Bundles

| Bundle                                                                                                                                                                                                |                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| <Bundle name="ATT_US" />                                                                                                                                                                              | AT&T postpaid and prepaid                 |
| <Bundle name="ATT_NR_US" />                                                                                                                                                                           | ??? (shares most of `ATT_US`'s rare keys) |
| <Bundle name="ATT_FirstNet_US" />                                                                                                                                                                     | FirstNet, the public safety network       |
| <Bundle name="ATT_Defense_US" />                                                                                                                                                                      | US government                             |
| <Bundle name="ATT_CC_US" />                                                                                                                                                                           | Cricket ???                               |
| <Bundle name="ATT_MVNO_US" />, <Bundle name="ATT_Puretalk_US" />, <Bundle name="ATT_RedPocket_US" />, <Bundle name="ATT_TFW_US" />, <Bundle name="ATT_KORE_US" />, <Bundle name="ATT_Dish_MVNO_US" /> | MVNOs on AT&T                             |
| <Bundle name="ATT_aio_US" />, <Bundle name="ATT_aio_NR_US" />                                                                                                                                         | ???                                       |

`ATT_US` matches these SIMs:

```
310170
310410_GID1-FFFF      (AT&T's main IMSI range)
311180_GID1-FFFF
310560_GID1-FFFF
310280_GID1-FFFF
310030
310950_GID1-FFFF
```

GID1 `FFFF` is an unset GID1, so these presumably mean "AT&T's own SIMs, not an MVNO's". The one `MVNOOverrides` configuration is for `310170` and only replaces the APN list with a single data APN called `phone`.

## Per-phone files

`ATT_US` 72.1 has 14 overrides pairs, one per group of phones, from the iPhone 11 to the iPhone 18 family. The iPhone 18 Pro (`V63`) and the iPhone 18 Pro Max sold outside the US (`V64s`) share a file in the Apple-modem format with board `V68`, which matches no announced device ???; the US iPhone 18 Pro Max (`V64`, Qualcomm X80) has its own. Each sets its own APN list (`nxtgenphone`, `hotspot`, `ims`, `sos`), 5G defaults and IMS settings, and carries a [.der.pri](/wiki/ios/der-pri) for the modem.

Only the modem files for Apple's own modems (`overrides_D23`, `overrides_V59`, `overrides_V159`: iPhone Air, iPhone 16e, iPhone 17e) set:

```
%u:dyn_cps.op_features.at_t_disable_geran_while_in_usa_mcc_enabled    1
```

AT&T shut down its GSM network in 2017; this tells the modem not to look for one on a US network.

## Wi-Fi

`ATT_US` still has the `WISPrAccounts` entry the [Apple Wiki](https://theapplewiki.com/wiki/Carrier.plist) documented around iOS 3, with the same shared secret:

```
WISPrAccounts
    phone@attmobility.com
        AuthenticationRealm     attmobilityiphone.com
        MatchingSSIDs           attwifi: .att.com, .att.net
        PasswordType            AT&T
        SharedSecret            a446649326d41d87dbb8caec8caf736a
```

Only `ATT_US`, `ATT_NR_US` and `ATT_FirstNet_US` have it. The bundle also installs a Wi-Fi profile for `attwifi` and `AT&T Secure Wi-Fi` (EAP-AKA); see [Carrier Bundle § profile.mobileconfig](/wiki/ios/carrier-bundle#profilemobileconfig).

## Wi-Fi Calling

AT&T is one of the few carriers with an `IMSConfigSecondaryOverlay`, a second set of IMS settings applied on top of `IMSConfig` (when exactly is ???). AT&T's turns on SRTP and adds:

```
EmergencyURNs.911                   911@one.att.net
AdditionalHeaders.REGISTER[wifi]    P-IMS-Softphone-Label: 6172637469637365636f6e6461727921;${SHORT_DEVICE...
```

The hex in the Wi-Fi Calling registration header decodes to `arcticsecondary!`. ???

## eSIM

`RemoteCardProvisioningSettings.ActivatingStateSubscriptionCheckTimerIntervals` is how often the phone checks whether a new eSIM has been activated. AT&T's first checks are 15, 30, 60 and 90 seconds. The median across all bundles is <Setting path="RemoteCardProvisioningSettings.ActivatingStateSubscriptionCheckTimerIntervals[*]" show="median" /> seconds (_live_).

`CarrierAuthHost` (`https://www.att.com/buy/byod/`) is only set by `ATT_US` and `ATT_NR_US`.

## See also

- [Carrier Bundle](/wiki/ios/carrier-bundle)
- [Verizon](/wiki/ios/verizon), [T-Mobile US](/wiki/ios/t-mobile-us)
