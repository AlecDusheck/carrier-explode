---
title: Vodafone UK
searchTitle: "Vodafone UK iPhone carrier bundle: settings, quirks"
description: "What is unusual in Vodafone UK's iOS carrier bundle: the only default 5G network slice, captive portal bypasses, and a once-a-day eSIM check."
updated: 2026-10-02
category: carrier
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
</script>

Vodafone UK's bundle is <Bundle name="Vodafone_uk" version />. It is a small bundle (about 250 values, a quarter of [T-Mobile US](/wiki/t-mobile-us)'s) with one `SupportedSIMs` entry, `23415`.

Related bundles: <Bundle name="Vodafone_Cambio_uk" />, <Bundle name="Talkmobile_uk" /> (a Vodafone sub-brand that shares most of the rare keys below) and <Bundle name="Vodafone_Travel" />.

## 5G network slicing

`Vodafone_uk` is the only bundle that sets a default network slice for internet traffic:

```
DefaultInternetSNSSAI
    SliceServiceType        1       (eMBB)
    SliceDifferentiator     1
```

An S-NSSAI identifies a 5G standalone slice. SST 1 is the standard type for mobile broadband. `NRSlicing` appears in two other UK bundles, `BT_Business_uk` and `TMobile_uk` (EE).

## Wi-Fi

`CaptiveSettingsBySSID` marks two Wi-Fi networks as not needing a captive portal check:

```
Auto-BTWiFi     Bypass  true
VodafoneWiFi    Bypass  true
```

Only `Vodafone_uk`, `Vodafone_Cambio_uk` and `Talkmobile_uk` have it. `Auto-BTWiFi` is BT's network; Vodafone and BT have had a Wi-Fi roaming agreement. The Apple Wiki's example of this key, from the iOS 3 era, was `BTOpenzone`.

## Calls

`IMSConfig.Signaling.IncomingCallEndReasons.InvalidNumber` maps SIP `404` to Q.850 cause 1 (unallocated number) and sets `DisableCSFB`, so a call to a number that does not exist is not retried over 2G/3G. Only `Vodafone_uk` and `Talkmobile_uk` have it.

## eSIM

The last of the intervals at which the phone checks whether a new eSIM has been activated is 86400 seconds: after the first few tries it checks once a day.

## See also

* [Vodafone_Travel § Typos and placeholders](/wiki/carrier-plist#typos-and-placeholders) (`Key New` = `Value`)
