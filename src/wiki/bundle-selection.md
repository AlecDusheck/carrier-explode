---
title: Bundle Selection
searchTitle: "How iOS picks a carrier bundle for a SIM"
description: "How iOS gets from a SIM to a carrier bundle, how MVNOs share one, how per-phone overrides and country bundles are layered on top, and which copy wins."
updated: 2026-10-02
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
  import Setting from "#lib/components/wiki/Setting.svelte";
</script>

**Bundle selection** is how iOS decides which [carrier bundle](/wiki/carrier-bundle) applies to a SIM, and which settings from it apply to a particular phone. It is done by CommCenter. Several layers end up contributing to the settings a phone runs with:

1. the **carrier bundle** picked for the SIM
2. an **MVNO configuration** inside that bundle, if the SIM matches one
3. the **overrides file** for the phone's board, if the bundle has one
4. the **country bundle** for the network the phone is on

The order in which 2 and 3 are applied when both match is ???.

## SIM to bundle

What the phone can read from a SIM:

| Value | Example | Where it comes from |
|-------|---------|---------------------|
| MCC+MNC | `310410` | first 5 or 6 digits of the IMSI |
| ICCID | `8901410...` | SIM serial number; starts with `89` and the country calling code |
| GID1, GID2 | `6F`, `A3` | group identifier files on the SIM, set by the operator |

The [manifest](/wiki/carrier-bundle-manifest) maps these to a bundle name: first the `MVNOs` list under the MCC+MNC in `MobileDeviceCarriersByMccMnc` (matched on ICCID prefix, GID1, GID2, or a combination), then the plain `BundleName`. `MobileDeviceCarriers` maps bare ICCID prefixes.

A bundle then confirms the match with `SupportedSIMs` in its `carrier.plist`. Across 1,005 current bundles, `SupportedSIMs` entries come in four forms:

| Form | Entries | Example |
|------|---------|---------|
| `<MCCMNC>` | 940 | `23410` |
| `<MCCMNC>_ID-<ICCID prefix>` | 722 | `33805_ID-8901050019` |
| `<MCCMNC>_GID1-<hex>` | 550 | `22210_GID1-20` |
| `<MCCMNC>_GID2-<hex>` | 112 | |

`Digicel_ht` lists every ICCID block it has issued separately (`33805_ID-8901050019`, `33805_ID-8901050029`, ...).

### Shared IMSI ranges

Many SIMs do not carry their own carrier's MCC+MNC. Travel and IoT SIMs, and some national MVNOs, are issued on a host network's IMSI range, and only the ICCID or GID tells them apart. MCC+MNC `20404`, <Bundle name="Vodafone_nl" />, is the extreme case: 26 different bundles hang off it, including Bell, Sasktel and Videotron in Canada, Pelephone in Israel, China Telecom, US Cellular and four of Verizon's MVNOs (Visible, Xfinity Mobile, Spectrum Mobile, Verizon Response). A Visible SIM is MCC+MNC `20404`, ICCID `891480...`, GID2 `1A`.

## MVNO configurations

40 bundles also hold `MVNOOverrides`: several MVNOs riding on one bundle, each with its own `SupportedSIMs` and a partial `carrier.plist`:

```
MVNOOverrides
    Configuration_1
        SupportedSIMs           338180, 344920, 376350, 37635, 365840
        OverrideConfiguration
            apns                ...
            CarrierName         ...
            IntlDataRoamingAllowed  ...
```

The configurations are usually named `Configuration_1`, `Configuration_2` and so on, but the names are arbitrary (`Telefonica_eSimFLAG` uses `Configuration_Carrier1`). `Sprint_CSIM_LTE_US` has the most, five.

What MVNO configurations change, most common first:

* `IntlDataRoamingAllowed` - the networks the MVNO may roam on
* `apns`, `AttachAPN`
* `StatusBarImages`, `CarrierName`, `OverrideOperatorName` - the name shown on the phone
* `Services`, `MyAccountURL` - the carrier services menu
* `IMSConfig`, `CarrierEntitlements` - VoLTE, Wi-Fi Calling, eSIM
* `CarrierBookmarks` - Safari bookmarks

An `OverrideConfiguration` can also remove a key inherited from the main bundle with `_Exclude`:

```
_Exclude    MMS                 (Softbank_jp, KDDI_LTE_only_jp)
_Exclude    StockSymboli        (Sprint_CSIM_LTE_US, four of its five MVNOs)
```

`StockSymboli` is the Stocks app key from iOS 1; the main `Sprint_CSIM_LTE_US` still adds `TMUS` to Stocks, and its MVNOs remove it.

Two bundles have `_Exclude` at the top level of `carrier.plist` (`Telus_PublicMobile_ca` excludes `EnableLTEAfterUpgrade`, `ChinaTelecom_USIM_mo` excludes `CDMAInternationalRoaming`) while still setting those keys themselves. What it does there is ???.

`TMobile_US` goes further and ships separate baseband files for its MVNOs, `overrides_mvno1_*.der.pri`, next to the normal ones.

## Per-phone overrides

A bundle can carry `overrides_<boards>.plist` files. The file name lists the board IDs (`D93`, `V53`) of the phones it is for, and on those phones it is merged into `carrier.plist`: a dictionary is combined key by key with the same dictionary there, and any other value replaces it. The files only make sense that way. <Bundle name="ATT_US" />'s per-phone `IMSConfig` sets three keys; replacing the whole dictionary would leave those phones without the rest of their IMS settings, VoLTE included. Lists such as `apns` are always given in full. Each one usually comes with a `.der.pri` for the modem (see [.der.pri](/wiki/der-pri)).

| File (ATT_US 72.1) | Phones |
|--------------------|--------|
| `overrides_V53_V54_V57` | iPhone 17 Pro, 17 Pro Max, 17 |
| `overrides_D23` | iPhone Air |
| `overrides_V159` | iPhone 17e |
| `overrides_D93_D94_D47_D48` | iPhone 16 Pro, 16 Pro Max, 16, 16 Plus |
| `overrides_V59` | iPhone 16e |
| `overrides_D79` | iPhone SE (2nd generation) |
| `overrides_D421_D431_N104` | iPhone 11 Pro, 11 Pro Max, 11 |

Phones that share a modem usually share a file, but not always, and bundles do not agree with each other: some have `overrides_D421_D431_N104_D79` (the iPhone 11 family and the iPhone SE (2nd generation) together), others `overrides_D421_D431_N104` and `overrides_D79` separately.

A phone with no overrides file for it gets `carrier.plist` alone. That is not always intentional: the copy of a bundle in an iOS image only has the overrides for the phones that image was built for (see [Carrier Bundle § Image copies and OTA copies](/wiki/carrier-bundle#image-copies-and-ota-copies)). The image copy is replaced as soon as a newer OTA copy is downloaded.

## Image copy or OTA copy

A phone can have two copies of its bundle: the one in the iOS image, and one downloaded from the manifest. The one with the higher bundle version is used. The image copy wins a tie. Image copies are versioned `72.0.2` and OTA copies `72.1`, so for most of an iOS release the OTA copy wins, and a new iOS version brings an image copy that beats the old OTA copy.

The manifest lists bundles per iOS version (`27.0`, `26.4`, ...), so a phone only ever downloads a bundle meant for its own iOS version or older. `ByProductType` can give a model its own list: the iPhone 6 and 6 Plus had separate builds of `ATT_US` from iOS 8.1 to 12.0.

## Country bundles

The country bundle is picked from the network, not the SIM: the MCC of the network the phone is registered on goes through `CountryBundles.iPhone.CountryId` and `BundleMappings` in the manifest. A US SIM roaming in Australia gets `ATT_US` and `Australia`.

Country bundles carry the settings that belong to the place: mostly cell broadcast (which emergency alert channels exist, what they are called, which ones can be turned off) and regulatory switches. The `Australia` bundle is a 1.7 KB `carrier.plist` with nothing but `CellBroadcast`.

A carrier bundle names its own country with `HomeBundleIdentifier`, as <Bundle name="ATT_US" file="carrier.plist" /> in `ATT_US` does:

```
HomeBundleIdentifier    com.apple.UnitedStates
```

Today <Setting path="HomeBundleIdentifier" /> carrier bundles have it (*live*); in October 2026, 80 of 663 pointed at `com.apple.UnitedStates`. Older bundles do not, and their home country can only be guessed from the `_cc` suffix of the name.

## See also

* [Carrier Bundle Manifest](/wiki/carrier-bundle-manifest)
* [Carrier Bundle](/wiki/carrier-bundle)
* [Carrier.plist](/wiki/carrier-plist)
* [.der.pri](/wiki/der-pri)
