---
title: Rakuten Mobile
searchTitle: "Rakuten Mobile iPhone carrier bundle: quirks"
description: "What is unusual in Rakuten Mobile's iOS carrier bundle: a 50-minute SIP timer, XCAP over plain HTTP, one-minute emergency alerts, and a misspelled watchOS key."
updated: 2026-10-02
category: carrier
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
  import SettingTable from "#lib/components/wiki/SettingTable.svelte";
</script>

Rakuten Mobile's bundle is <Bundle name="Rakuten_jp" version />. Rakuten built Japan's fourth mobile network from 2020 on a cloud-native core, and several of its settings are far from every other carrier's.

## SIP Timer B

```
IMSConfig.Signaling.SipTimers.B     3000000
```

Timer B is how long a phone waits for a reply to a call setup (INVITE) before giving up. RFC 3261 makes it 64 × T1, 32 seconds; Rakuten's is 3,000,000 ms, 50 minutes.

<SettingTable rows={[{ path: "IMSConfig.Signaling.SipTimers.B", note: "milliseconds" }]} />

## XCAP

```
NafHost             xcap.ims.mnc011.mcc440.pub.3gppnetwork.org
NafPort             8081
BsfHost             bsf.ims.mnc011.mcc440.pub.3gppnetwork.org
BsfPort             8082
useSecureTransport  false
```

XCAP carries call forwarding and call waiting settings. Rakuten's is plain HTTP on 8081 and 8082; only three of the 41 bundles that set `useSecureTransport` turn it off.

## Emergency alerts

`CellBroadcast.MessageValidityPeriod.TimeLimit` is 60. The usual value is 5760. ??? (the unit, and what happens when it runs out)

## Typo

```
RemoteCardProvisioningSettings.MinCompatibileWatchOS    8.5
```

`MinCompatibile` is only in this bundle. It presumably sets the oldest watchOS that can share the line.

## Other

* `IMSConfig.Media.DTMFVolume` (10) is only here and in `Docomo_jp`.
* `com.apple.voicemail.imap.GreetingNotification` is false in Rakuten and two other bundles, out of 230.

## See also

* [Carrier.plist § Extreme values](/wiki/ios/carrier-plist#extreme-values)
