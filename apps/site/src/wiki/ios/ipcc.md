---
title: IPCC
searchTitle: ".ipcc files: iOS carrier bundle downloads"
description: "The .ipcc file a carrier bundle is shipped in, where Apple hosts them, how they are named and checksummed, and how the URL scheme has changed since 2009."
updated: 2026-10-02
---

An **IPCC** (`.ipcc`, iPhone Carrier Configuration ???) is the file a [carrier bundle](/wiki/ios/carrier-bundle) is shipped in. It is a plain ZIP archive with a single `Payload/` folder:

```
Payload/
    ATT_US.bundle/
        Info.plist
        carrier.plist
        ...
```

Nothing outside `Payload/` is used. There is no outer signature on the archive; the files inside are signed (see [Carrier Bundle § signatures/](/wiki/ios/carrier-bundle#signatures)), and the [manifest](/wiki/ios/carrier-bundle-manifest) gives a digest of the archive itself.

## Naming

On Apple's servers the file is named `<BundleName>_<family>.ipcc`:

| Suffix    | Files in the manifest | Notes                                                   |
| --------- | --------------------- | ------------------------------------------------------- |
| `_iPhone` | 3291                  |                                                         |
| `_iPad`   | 863                   | cellular iPads, published under `ByProductType`         |
| `_Watch`  | 301                   | cellular Apple Watch                                    |
| none      | about 300             | the 2008-2010 files, e.g. `ATT_US.ipcc`, `Bell_ca.ipcc` |

The same bundle name is used for all three families, so `1and1_de_iPhone.ipcc`, `1and1_de_iPad.ipcc` and `1and1_de_Watch.ipcc` are three different bundles with three different version histories.

## Hosts and paths

The manifest lists 4967 files (4855 distinct URLs) on four hosts. Most are still HTTP.

| Host                               | Files | Years     | Path                                                                                                  |
| ---------------------------------- | ----- | --------- | ----------------------------------------------------------------------------------------------------- |
| `appldnld.apple.com.edgesuite.net` | 259   | 2009-2010 | `/content.info.apple.com/iPhone/CarrierBundles/061-4732.20090203.gj3ef/ATT_US.ipcc`                   |
| `appldnld.apple.com`               | 3053  | 2010-2015 | `/iOS7/CarrierBundles/031-2099.20131204.rVQEN/2degrees_nz_iPhone.ipcc`                                |
| `updates-http.cdn-apple.com`       | 43    | 2018      | `/2018/ios/carrierbundles/091-80246-20180504-CC3E1C52-4D8B-11E8-BA4C-38D21A00AB6B/AIS_th_iPhone.ipcc` |
| `updates.cdn-apple.com`            | 1612  | 2018-     | `/20261001/carrierbundles/142-29613/9763C9C0-86F5-4D14-8B50-2C02ACE04457/ATT_US_iPhone.ipcc`          |

The parts are, in each scheme, an Apple part number (`061-4732`, `142-29613`), a date, and a random tag (`gj3ef`) or a UUID. From 2015 to 2019 the date and UUID were joined into one folder name (`031-04427-20150119-AC94FC46-...`); since 2023 the date is its own folder. One 2019 iPad URL has a malformed date, `041-56849-2019503-...`.

The oldest file still listed is `ATT_US.ipcc` 3.1 from 2009-02-03. Some of the HTTP hosts no longer answer on HTTP, and some no longer answer on HTTPS, so a client fetching old bundles has to try both. `appldnld.apple.com.edgesuite.net` now answers with a 301.

## Digests

Each manifest entry carries the archive's digest. Which key and which hash depends on the era:

| Keys                                       | Entries | Hash                                                                 |
| ------------------------------------------ | ------- | -------------------------------------------------------------------- |
| `Digest` (20 bytes)                        | 3980    | SHA-1                                                                |
| `Digest` (20 bytes) + `Digest3` (48 bytes) | 411     | SHA-1 and SHA-384                                                    |
| `Digest` (48 bytes)                        | 270     | SHA-384. Watch and country bundles use the plain `Digest` key for it |
| none                                       | 306     | the 2009-2010 files                                                  |

## Copies inside iOS images

iOS images (IPSWs) contain their own copies of most bundles, already unpacked: carrier bundles in `/System/Library/Carrier Bundles/iPhone/`, country bundles in `/System/Library/CountryBundles/iPhone/` (no space). If you zip one up you do not get the published `.ipcc` back: the file order, timestamps and compression differ, so the digest never matches, and the image copy only has the [overrides](/wiki/ios/carrier-bundle#overrides_plist-and-overrides_derpri) for the phones the image is for. Compare the version numbers instead (`72.0.2` in the image, `72.1` published).

## Loading an IPCC by hand

Finder (and older iTunes) can install a local `.ipcc` once carrier testing is turned on:

```
defaults write com.apple.AMPDevicesAgent carrier-testing -bool YES
```

then Option-click "Check for Update" with the phone connected. Only bundles Apple signed will be accepted.

## See also

- [Carrier Bundle](/wiki/ios/carrier-bundle)
- [Carrier Bundle Manifest](/wiki/ios/carrier-bundle-manifest)
- [Carrier Bundle](https://theapplewiki.com/wiki/Carrier_Bundle) on The Apple Wiki
