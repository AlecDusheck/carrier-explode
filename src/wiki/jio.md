---
title: Jio
searchTitle: "Jio iPhone carrier bundle: settings and quirks"
description: "What is unusual in Reliance Jio's iOS carrier bundle: Wi-Fi Calling rules for emergency calls, a misspelled key, odd XCAP ports and live ID checks for eSIM."
updated: 2026-10-02
category: carrier
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
  import Setting from "#lib/components/wiki/Setting.svelte";
</script>

Reliance Jio's bundle is <Bundle name="RelianceJio_in" version />. Jio has no sub-brand bundles, but its one bundle lists 44 `SupportedSIMs` entries, one for each of the MCC+MNCs it uses across India's telecom circles.

## Wi-Fi Calling

Jio's IMS settings have three things no other bundle has:

```
RequiresCellularFootprintForVoWiFiRegistration    true
IgnoreWifiHotspot                                 false
ServiceClass.Hotspot                              Voice EF, Video AF43, Signaling CS5
```

The first means Wi-Fi Calling only registers when the phone can also see Jio's cellular network: Indian rules require a phone's location to be known for calls. The other two concern Wi-Fi Calling while the phone is a hotspot, and set DSCP marks for it.

An incoming call ending with SIP `500` and the reason `Emergency calls over WiFi not allowed in this location` is mapped to `NoEmergencyCallLocation`. No other bundle has this text.

`EmergencyCallBackModeExpirationSeconds` is 1. The median is <Setting path="IMSConfig.Signaling.EmergencyCallBackModeExpirationSeconds" show="median" /> (*live*), and South Korea's country bundle sets 1800.

## Typo

```
IMSConfig.Signaling.IncomingCallEndReasons.RequestTermiante
    StatusCode          412
    ReasonHeaderCause   31
```

`RequestTermiante` (for `RequestTerminate`) is only in this bundle.

## XCAP

Supplementary services (call forwarding, call waiting) go over XCAP on ports 7077 (NAF) and 7080 (BSF). Most bundles use 443. `FetchAllCDIVRules` is only set here and in `Comcel_co`.

## eSIM and RCS

* `RemoteCardProvisioningSettings.RequireLiveIDCheck` is true only for Jio, `ChinaTelecom_USIM_cn` and `Unicom_cn`.
* `RCS.VendorID` is 2, shared only with the `China` and `SouthKorea` country bundles.
* `IMSConfig.Signaling.EnableVideoCallWaiting` is only in this bundle.

## See also

* [Carrier.plist](/wiki/carrier-plist)
