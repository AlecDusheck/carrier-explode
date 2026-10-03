---
title: Carrier Bundle
searchTitle: "iOS carrier bundles: what's inside and how they work"
description: "What an iOS carrier bundle is, what is inside one today, where it comes from, and how it is versioned and signed."
updated: 2026-10-02
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
  import Setting from "#lib/components/wiki/Setting.svelte";
</script>

A **carrier bundle** is a folder of settings that iOS applies for a particular carrier: APNs, MMS, VoLTE and Wi-Fi Calling (IMS), voicemail, emergency calling, cell broadcast, the carrier name, the Settings menus the carrier is allowed to show, and, on current phones, a set of files that are handed straight to the baseband. Apple builds and signs every bundle; carriers do not ship their own.

Bundles are distributed as [IPCC](/wiki/ipcc) files. A copy of most bundles also ships inside each iOS image, and newer copies are published separately through the [carrier bundle manifest](/wiki/carrier-bundle-manifest) so that settings can change without an OS update.

There are two kinds:

* **Carrier bundles**, named `<Carrier>_<cc>` (`ATT_US`, `Vodafone_uk`, `KDDI_UQ_NR_jp`). Chosen from the SIM. See [Bundle Selection](/wiki/bundle-selection).
* **Country bundles**, named after a country (`Australia`, `UnitedStates`, `SaudiArabia`). Chosen from the MCC of the network the phone is on, whatever SIM is inserted. These are small and mostly carry cell broadcast (emergency alert) settings and a handful of regulatory switches. Of these, <Bundle name="SaudiArabia" kind="countries" /> is the only bundle with `ShowIMEIsInLockScreen`, and <Bundle name="Taiwan" kind="countries" /> and <Bundle name="HongKong" kind="countries" /> the only ones with `Show2GRegulatorySwitch`.

There are also a few bundles that do not belong to any carrier or country: `Default`, `Unknown`, `OtherKnown`, `CarrierLab`, `NonPublicNetwork`, `Bootstrap_ATT_US`, `Bootstrap_Verizon_US`, `OQCFactoryMultimode` and `OQCFactoryUMTS`. See [Special bundles](#special-bundles).

## Structure

As of iOS 27 (`ATT_US` 72.1, published 2026-10-01; the current copy is <Bundle name="ATT_US" version />):

```
Payload/
    ATT_US.bundle/
        Info.plist                                - bundle description
        version.plist                             - build info
        carrier.plist                             - main settings
        overrides_D93_D94_D47_D48.plist           - settings for iPhone 16 Pro, 16 Pro Max, 16, 16 Plus
        overrides_D93_D94_D47_D48.der.pri         - baseband settings for the same phones
        overrides_...                             - one pair per group of phones (15 pairs in this copy)
        profile.mobileconfig                      - Wi-Fi profile (attwifi, AT&T Secure Wi-Fi)
        signatures/
            common.plist                          - signatures for the bundle itself
            overrides_D93_D94_D47_D48.plist       - signatures for one overrides pair
            ...
        en.lproj/
            carrier.strings                       - localised service names
            CBMessage.strings                     - "Carrier Settings Updated" alert
            locversion.plist                      - localisation build
        ...38 more .lproj folders
```

The status bar logos (`Default_CARRIER_*.png`, `FSO_CARRIER_*.png`) and the `MCCMNC` symlink that older bundles had are gone. A country bundle like `Australia` 69.1 is just `Info.plist`, `version.plist`, `carrier.plist` and `signatures/common.plist`, 3 KB zipped.

### Info.plist

```
CFBundleIdentifier          com.apple.ATT_US
CFBundleName                ATT_US
CFBundleExecutable          ATT_US        (there is no executable)
CFBundleDeviceFamily        iPhone        (or Watch)
CFBundlePackageType         BNDL
CFBundleShortVersionString  72.1.0
CFBundleVersion             72.1
CFBundleSignature           ????
```

### version.plist

```
ProjectName                 CarrierBundles
SourceVersion               4566011000000000
CFBundleVersion             72.1
CFBundleShortVersionString  72.1.0
BuildVersion                1
```

`SourceVersion` is the internal project version. It lines up with `LprojVersion` in each `locversion.plist` (here `4566.11`).

### `overrides_*.plist` and `overrides_*.der.pri`

Most carrier bundles carry per-phone files named after the boards they apply to: `overrides_D23.plist` is for the iPhone Air (D23), `overrides_V53_V54_V57.plist` for the iPhone 17 Pro, 17 Pro Max and 17. Keys in an overrides plist take the place of the same keys in `carrier.plist` on those phones. AT&T uses them to give each phone its own APN list, 5G defaults and IMS tweaks.

Each overrides plist names its baseband file with `DerPriFileName` and `DerPriFileVersion`:

```
DerPriFileName      overrides_D23.der.pri
DerPriFileVersion   1.0.2
```

The `.der.pri` is sent to the modem as-is and is never read by iOS. See [.der.pri](/wiki/der-pri).

Older bundles still carry plaintext [.pri](/wiki/pri) files for older phones (`overrides_N66_N71.pri`, `overrides_J72_J86.pri`), and 41 US regional carriers that once ran CDMA have a `carrier.pri`. `TMobile_US` is the only bundle with per-MVNO baseband files (`overrides_mvno1_*.der.pri`).

Watch bundles do the same with watch boards (`overrides_N199.plist` for the Apple Watch Ultra).

### signatures/

Every file iOS reads is signed. `signatures/common.plist` covers the bundle; each `signatures/overrides_*.plist` covers one overrides pair and holds a separate signature for its `.der.pri`:

```
CBSignature2                    <256 bytes>
CBSignature3                    <102 bytes>
overrides_D23.der.pri2          <256 bytes>
overrides_D23.der.pri3          <103 bytes>
```

The `2` signatures are 256 bytes (RSA-2048 sized). The `3` signatures are DER `SEQUENCE`s of two integers, 102 to 104 bytes long, which is the size of an ECDSA P-384 signature. Which files `common.plist` covers is ???. Before iOS 4 only the APNs were signed (see the [Apple Wiki page](https://theapplewiki.com/wiki/Carrier_Bundle)), with a `signature` key at the end of `carrier.plist`. 64 bundles still have that key alongside `signatures/`.

### profile.mobileconfig

Profiles ship in <Setting path="PayloadContent[*].PayloadType" file="profile.mobileconfig" /> carrier bundles (*live*). In October 2026, 167 of their 175 payloads were `com.apple.wifi.managed`: carrier hotspots and EAP-SIM/AKA networks. AT&T's sets up `attwifi` and `AT&T Secure Wi-Fi` (EAP-AKA, `MCCAndMNCs` 310410). Apple's own key in it is misspelled: `EAPSIMAKAPsudeonymIdentityLifetimeHours`.

The rest are more interesting. The Spectrum and Xfinity Mobile bundles (`Verizon_Charter_LTE_US`, `TMobile_Charter_US`, `Verizon_Comcast_LTE_US`, `TMobile_Comcast_US`) install a root certificate (`DigiCert Global Root CA`, `AAA Certificate Services`), presumably so the phone trusts the RADIUS servers behind their Wi-Fi networks. `8ta_za` installs `VeriSign Class 3 Public Primary Certification Authority - G5`. The three `iusacell` bundles in Mexico add a `com.apple.domains` payload.

### .lproj folders

`carrier.strings` holds translations for names in `carrier.plist`. The keys are the English name with a suffix: `Check Bill Balance_SERVICE_NAME`, `AT&T MyAccount_MYACCOUNTURLTITLE`.

`CBMessage.strings` is not about cell broadcast. It is the alert shown after a bundle update:

```
CBMessageTitle          Carrier Settings Updated
CBMessageBody           New settings required for your device have been installed.
CBMessageAcceptButton   OK
```

Ten bundles (`Softbank_jp`, `Rogers_ca`, `ATT_NR_US` and others) use the newer single-file `carrier.loctable` instead.

### Other files

| File | Where | What |
|------|-------|------|
| `ERI.plist` | 93 bundles, mostly US | CDMA/LTE roaming indicator table |
| `supported_devices.plist` | 87 bundles | `SupportedDevices`, `SupportedDevicesExactMatch`, `SupportedSIMOverrides` |
| `bundle.metadata` | `TIM_br` only | Apple's internal build metadata, shipped by mistake. See below |

## Versions

Bundle versions are `<major>.<minor>`. `ATT_US` was 3.1 in 2009, 18.1 for iOS 8.1, 26.1 for iOS 10.0 and 72.1 for iOS 27.0. The copy inside an iOS image gets a three-part version (`72.0.2` in iOS 27.0.1 build 24A446) and the copy published on its own a two-part one (`72.1`). The phone keeps whichever has the higher version, so a published bundle replaces the image copy until the next iOS update brings a newer one.

## Image copies and OTA copies

The copy of a bundle inside an iOS image only contains the overrides for the phones that image was built for. The iOS 27.0.1 image for the iPhone 16 Pro has `ATT_US` with only `overrides_D93_D94_D47_D48.*`. Copies published through the manifest (OTA) usually contain every phone's overrides. Because of this, two copies of the same bundle version can differ in size by a factor of six or more. carrier-explode extracts every iPhone image of a release and merges each bundle's files, so the image copies shown here carry every phone's overrides.

## Special bundles

* `Default` - fallback settings, plus 18 MB of data that belongs to no carrier: emergency alert sounds, network name and country code tables, the regional modem tables (`.der.gri`) and on-body detection thresholds. See [Default bundle](/wiki/default-bundle).
* `Unknown` - presumably used for SIMs no bundle matches. It is the only bundle with `ApplyGSMASettings`.
* `OtherKnown` - listed in the manifest under `CarrierBundles.iPhone.OtherKnownSettings`. `region_lookup_1.plist` maps an MCC/MNC to a configuration in `gsma_1.plist` (`Configuration_20221`, `Configuration_20614_GID1-0E`), so carriers without a bundle of their own still get APNs.
* `CarrierLab` - test bundle. Uses alert types named `AT1_Presidential` to `AT7_Test` and `AT1_Quake`, an XCAP BSF at `bsf.test.3gpp.com`, and is the only bundle with `SupportsFauxCard`.
* `NonPublicNetwork` - presumably private LTE/5G networks. It is the only bundle with `Show5GSAWarningUnsupportedCarriers`.
* `Bootstrap_ATT_US`, `Bootstrap_Verizon_US` - probably used while an eSIM is being set up. They are the only bundles with `BootstrapOverrideOperatorName` and `CellularPlanSettings`, and `Bootstrap_ATT_US` is the only one of 44 bundles with `RemoteDiagnosticsWWANAllowed` set to false.
* `OQCFactoryMultimode`, `OQCFactoryUMTS` - factory test. OQC is probably outgoing quality control.
* `Defense_US`, `ATT_Defense_US`, `ATT_FirstNet_US` - US government and public safety networks.

### `TIM_br` bundle.metadata

The copy of <Bundle name="TIM_br" /> on iOS 26.1 contains a `bundle.metadata` that no other bundle has. It is the record of how the bundle was made:

```
buildIdentifier     iPhone_TIM_br
buildName           23B53
train               LuckB
bundleType          Carriers
device              iPhone
originalVersion     65.7.2
version             165.7.3
filesModified       overrides_D63_D64_D16_D17.plist, overrides_D79.plist,
                    overrides_C743.plist, overrides_D421_D431_N104.plist,
                    overrides_D49.plist, overrides_V59.plist
ipccPath            /Users/<engineer>/Documents/Carriers/BR-Vivo/Emergency Numbers Update/iPhone/TIM_br_iPhone_165.7.3.ipcc
```

The path has been shortened here; the original has the engineer's home folder. A few things can be read from it. Bundle edits are tracked against an iOS train (`LuckB`; build 23B53 is iOS 26.1). The version went from 65.7.2 to 165.7.3, with 100 added to the major, probably to mark an engineering build. The folders say the change was an emergency numbers update, filed under Vivo, a different Brazilian carrier. `C743` does not match any announced device. ???

## See also

* [IPCC](/wiki/ipcc)
* [Carrier.plist](/wiki/carrier-plist)
* [Bundle Selection](/wiki/bundle-selection)
* [.der.pri](/wiki/der-pri), [PRI](/wiki/pri), [.der.gri](/wiki/der-gri)
* [Default bundle](/wiki/default-bundle)
* [Carrier Bundle Manifest](/wiki/carrier-bundle-manifest)
* [Carrier Bundle](https://theapplewiki.com/wiki/Carrier_Bundle) on The Apple Wiki
