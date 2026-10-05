---
title: Verizon
searchTitle: "Verizon iPhone carrier bundle: settings and quirks"
description: "What is unusual in Verizon's iOS carrier bundle: MVNOs told apart by GID2, mmWave settings, no Wi-Fi handover during 911 calls, and big MMS video."
updated: 2026-10-02
category: carrier
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
  import Setting from "#lib/components/wiki/Setting.svelte";
</script>

Verizon's main bundle is <Bundle name="Verizon_LTE_US" version />. The `_LTE_` is left over from the switch away from CDMA; the CDMA-era bundle was `Zeppelin_US`, and Verizon's CDMA carrier ID `310VZW` still points at it in the [manifest](/wiki/ios/carrier-bundle-manifest#mobiledevicecarriersbycarrierid).

## Bundles

| Bundle | |
|--------|---|
| <Bundle name="Verizon_LTE_US" /> | Verizon |
| <Bundle name="Verizon_MVNO_US" /> | MVNOs without their own bundle; shares most of Verizon's rare keys |
| <Bundle name="Verizon_Visible_LTE_US" />, <Bundle name="Verizon_Core_Visible_LTE_US" /> | Visible |
| <Bundle name="Verizon_Comcast_LTE_US" /> | Xfinity Mobile |
| <Bundle name="Verizon_Charter_LTE_US" /> | Spectrum Mobile |
| <Bundle name="Verizon_Cox_LTE_US" /> | Cox Mobile |
| <Bundle name="Verizon_Response_LTE_US" /> | Verizon Response ??? |
| <Bundle name="Verizon_Credo_LTE_US" />, <Bundle name="Verizon_Ting_LTE_US" />, <Bundle name="Verizon_TFW_LTE_US" /> | other MVNOs |

## SIM matching

Verizon's own SIMs use three IMSI ranges, and the bundles on them are told apart only by GID2:

```
Verizon_LTE_US      311480_GID2-FF, 310599_GID2-FF, 310590_GID2-FF,
                    311480_GID2-A8, 310599_GID2-A8, 310590_GID2-A8
```

In the manifest, Visible is GID2 `1A`, Xfinity Mobile `A3`, Spectrum Mobile `A7` and Verizon Response `1B`, all with ICCIDs starting `891480`. These same SIMs are also listed under Vodafone Netherlands' `20404`; see [Bundle Selection § Shared IMSI ranges](/wiki/ios/bundle-selection#shared-imsi-ranges).

## Emergency calls

Only `Verizon_LTE_US` and `Verizon_MVNO_US` have:

```
PreventWiFiHandoverInEmergency      true
```

A 911 call started on cellular stays on cellular, even if Wi-Fi Calling would otherwise move it.

## mmWave

`EnableMmWaveSisOutrank` (`1`) is only in `Verizon_LTE_US` and `Verizon_MVNO_US`. What it outranks is ???; Verizon was the main user of 28 and 39 GHz 5G in the US.

## MMS

`MMS.MaxVideoBitrate` is 15360000 (15 Mbit/s). The median across bundles that set it is <Setting path="MMS.MaxVideoBitrate" show="median" /> (*live*).

## Call end reasons

Verizon's `IMSConfig.Signaling.CallEndReasons` has an entry named `MediaserverCrash`, with the SIP reason text `Call dropped`. Only `Verizon_LTE_US`, `Verizon_Cox_LTE_US` and `Verizon_MVNO_US` have it.

## See also

* [AT&T](/wiki/ios/att), [T-Mobile US](/wiki/ios/t-mobile-us)
* [Bundle Selection](/wiki/ios/bundle-selection)
