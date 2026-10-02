---
title: Carrier Bundle Manifest
searchTitle: "Apple's carrier bundle manifest, table by table"
description: "The iTunes version plist that lists every published carrier and country bundle, and the lookup tables in it that turn a SIM into a bundle name."
updated: 2026-10-02
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
  import Manifest from "#lib/components/wiki/Manifest.svelte";
</script>

The **carrier bundle manifest** is a property list Apple serves at:

```
https://itunes.apple.com/WebObjects/MZStore.woa/wa/com.apple.jingle.appserver.client.MZITunesClientCheck/version
```

It is the same file iTunes has always checked for its own updates, and still has keys for iTunes for Windows, iPod updaters and Nike+ voice kits. It is plain XML and about 6.3 MB (October 2026). Carrier and country bundles take up most of it. It is the only public list of published [IPCC](/wiki/ipcc) files: there is no directory listing on Apple's CDN.

## Keys

| Key | Entries (live) | What |
|-----|---------|------|
| `MobileDeviceCarrierBundlesByProductVersion` | <Manifest table="MobileDeviceCarrierBundlesByProductVersion" /> | carrier bundles by name, then by iOS version |
| `MobileDeviceCarrierBundles` | <Manifest table="MobileDeviceCarrierBundles" /> | the original 2009-2010 list, one file per bundle |
| `MobileDeviceCarriersByMccMnc` | <Manifest table="MobileDeviceCarriersByMccMnc" /> | MCC+MNC to bundle name, with MVNOs |
| `MobileDeviceCarriers` | <Manifest table="MobileDeviceCarriers" /> | ICCID prefix to bundle name |
| `MobileDeviceCarriersByCarrierID` | <Manifest table="MobileDeviceCarriersByCarrierID" /> | CDMA-era carrier ID to bundle name |
| `CarrierBundles` | | Watch bundles, and `iPhone.OtherKnownSettings` |
| `CountryBundles` | | country bundles for iPhone and Watch |
| `CarrierBundleSignatures`, `CountryBundleSignatures` | | `Format1`, `Format2`, each holding a `signature3` |

## MobileDeviceCarrierBundlesByProductVersion

One dictionary per bundle name. Inside, one entry per iOS version that got a new bundle:

```
ATT_US
    27.0
        BuildVersion    72.1
        BundleURL       https://updates.cdn-apple.com/20261001/carrierbundles/142-29613/.../ATT_US_iPhone.ipcc
        Digest          <20 bytes, SHA-1>
        Digest3         <48 bytes, SHA-384>
    26.4
    ...
    8.0
    ByProductType
        iPad            6.1, 11.1, 13.3, 13.4
        iPhone          FallbackToByProductVersion = true
        iPhone7,1       8.1 ... 12.0
        iPhone7,2       8.1 ... 12.0
```

The version keys are iOS versions, not bundle versions: the `27.0` entry is the bundle for phones on iOS 27.0 and later, until a newer key appears. `ATT_US` had 25 of them in October 2026, from 8.0 to 27.0; the newest is now <Bundle name="ATT_US" version />.

`ByProductType` gives some devices their own history. `iPad` is a separate bundle (`ATT_US_iPad.ipcc`, at 41.1 for iPadOS 13.4). `iPhone7,1` and `iPhone7,2` (iPhone 6 Plus and 6) got their own builds of `ATT_US` from iOS 8.1 to 12.0, numbered like the main ones (18.1 for 8.1, 33.2 for 12.0). `FallbackToByProductVersion` means "nothing of its own, use the main list".

## MobileDeviceCarriersByMccMnc

Maps the MCC+MNC from the SIM's IMSI to a bundle. 750 entries are a plain `BundleName`; 172 carry an `MVNOs` list, which is checked first:

```
20404
    BundleName  Vodafone_nl
    MVNOs
        BundleName Bell_ca             ICCID 89302610
        BundleName Truphone_US         GID1  547275554B3030656E
        BundleName Verizon_Visible_LTE_US   GID2 1A   ICCID 891480
        BundleName Verizon_Comcast_LTE_US   GID2 A3   ICCID 891480
        BundleName Vodafone_Travel     GID1  C2
        ...26 in all
```

A match is on ICCID prefix, GID1, GID2, or a combination. 81 MCC+MNCs have only `MVNOs` and no `BundleName` of their own.

`20404` (Vodafone Netherlands) is the busiest. Vodafone NL's IMSI range is used by a lot of roaming, IoT and travel SIMs, so SIMs from Canada (Bell, Sasktel, Videotron, Xplornet), Israel, Qatar, South Africa, China Telecom, US Cellular and Verizon's MVNOs all arrive with MCC+MNC 20404 and are told apart by ICCID. `20601` (Proximus) does the same for Virgin France, NRJ, Holafly, Roamless and others. GID1 values are often ASCII: Truphone's `547275554B3030656E` is `TruUK00en`.

Some entries have both `ICCID` and `IntegratedCircuitCardIdentity` with the same value. ???

## MobileDeviceCarriers

ICCID prefix (5 to 8 digits) to bundle name. ICCIDs start with `89` and the country calling code, so `8901` is +1: `8901150` and `8901180` are `ATT_US`, `890100` is `GTA_gu`.

## MobileDeviceCarriersByCarrierID

32 entries, all US regional carriers from the CDMA era, keyed by MCC and a three-letter ID:

```
310ALK  AlaskaWireless_US
310SPR  Sprint_US
310VZW  Zeppelin_US
311IVC  IllinoisValley_US
330OPM  OpenMobile_pr
```

Verizon's ID maps to `Zeppelin_US`, presumably the codename of Verizon's original CDMA bundle. It is one of three bundles with a `DMUFileName` (DMU is CDMA Mobile IP key provisioning); the other two are `Tracfone_US` and `OQCFactoryMultimode`.

## CarrierBundles

`Watch` has its own `Bundles` (287), `BundleMappings` (205) and `IMSI` (350) tables. They work like the country bundle tables below, with `IMSI` keyed by MCC+MNC and an `MVNOs` list matched on `ICCID` and `GID2`.

`iPhone.OtherKnownSettings` lists the `OtherKnown` bundle (58.1, 59.1). It has no SIM mapping; see [Carrier Bundle § Special bundles](/wiki/carrier-bundle#special-bundles).

## CountryBundles

`iPhone` and `Watch` each have three tables:

```
CountryId
    204                         BundleMapKey  Netherlands_Map
    208                         BundleMapKey  France_Map
    com.apple.Australia         BundleMapKey  Australia_Map
BundleMappings
    Bulgaria_Map
        1   BundleMatchEntry Bulgaria_1   OS.Min 16.4
        2   BundleMatchEntry Bulgaria_2   OS.Min 17.5
        3   BundleMatchEntry Bulgaria_3   OS.Min 18.5
Bundles
    Australia_1
        BundleID        Australia
        BundleVersion   69.1
        BundleURL       .../Australia_iPhone.ipcc
        Digest          <48 bytes, SHA-384>
```

`CountryId` is keyed by MCC (numeric) or by bundle identifier (64 entries in all). A map can have several slots with different minimum iOS versions, so one country can have a different bundle for each OS range.

## Signatures

`CarrierBundleSignatures` and `CountryBundleSignatures` each hold `Format1` and `Format2`, and each of those a single `signature3`: a DER `SEQUENCE` of two integers, 102 or 103 bytes, the size of an ECDSA P-384 signature. What exactly is signed is ???.

## See also

* [IPCC](/wiki/ipcc)
* [Bundle Selection](/wiki/bundle-selection)
* [Carrier OTA Updates](https://theapplewiki.com/wiki/Carrier_OTA_Updates) on The Apple Wiki (iOS 5 to 8 carrier seeds, a different thing)
