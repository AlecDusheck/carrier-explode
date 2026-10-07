---
title: Apple ingest
searchTitle: "Apple ingest: IPSWs, AEA, APFS and the OTA manifest"
description: "How this site reads Apple's carrier files: iPhone IPSWs found through ipsw.me and AppleDB, the root filesystem decrypted and read in a container, copies merged across a build, and Apple's OTA carrier manifest."
updated: 2026-10-06
---

**Apple ingest** is how this site gets Apple's [carrier bundles](/wiki/ios/carrier-bundle): from the iOS images (IPSWs) of every in-scope iPhone, one build at a time, and from the bundles Apple publishes through its [carrier bundle manifest](/wiki/ios/carrier-bundle-manifest). iPad and Apple Watch bundles come only from the manifest.

## Feeds

| Source                         | Requests                                                                       | Gives                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [ipsw.me](https://ipsw.me)     | `api.ipsw.me/v4/devices`, `/v4/device/<identifier>?type=ipsw`                  | device names; each phone's release IPSWs and their dates                            |
| [AppleDB](https://appledb.dev) | `api.appledb.dev/device/main.json`, `/ios/index.json`, `/ios/iOS;<build>.json` | each device's boards, release day and name; beta IPSWs, which ipsw.me does not list |
| Apple's manifest               | the iTunes `version` plist                                                     | the published bundles, their digests and the SIM tables                             |

The IPSW check runs every 20 minutes; the manifest check, every 6 hours.

## iOS builds

A unit is one build with all its in-scope IPSWs, not one IPSW: each IPSW carries only the [override files](/wiki/ios/bundle-selection#per-phone-overrides) of its own phones, so a bundle is only whole once every IPSW of the build is read. In `24A446`, the `iPhone18,1` IPSW's copy of `ATT_US` has 8 files, against 47 in a copy merged from every IPSW of the build. Phones that share one IPSW file share one download.

The build is held once `releases/ios/<build>.json` is written; its metadata lists the phones it holds, so a phone listed for the build later plans it again.

### The IPSW job

Each IPSW is one step in the container, one after another:

| Step | What                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Open the IPSW in place: its zip directory and `BuildManifest.plist` over HTTP Range. The build must be the one planned.                                                                                                                                                  |
| 2    | Read each modem firmware package by Range, store it in `obj/`, and write its summary to `decoded/baseband/`.                                                                                                                                                             |
| 3    | Stream the root filesystem image the manifest names to disk. When it is a `.dmg.aea` (Apple Encrypted Archive), decrypt it on the way: the archive's key is wrapped (HPKE) in its auth data next to the URL of the private key that opens it, which Apple serves openly. |
| 4    | Copy `/System/Library/Carrier Bundles/iPhone` and `/System/Library/CountryBundles/iPhone` out of the APFS image with `apfs-extract`, a Go helper over [blacktop/go-apfs](https://github.com/blacktop/go-apfs) that needs no mount.                                       |
| 5    | Pack each bundle into a deterministic `.ipcc` and put it in the unit's `tmp/`.                                                                                                                                                                                           |

The AEA format and key schedule follow [blacktop/ipsw](https://github.com/blacktop/ipsw)'s `pkg/aea`.

### Merge

The last step runs in the Worker. For each bundle, the copies from the build's IPSWs are compared file by file:

- copies that are identical are stored as they are;
- otherwise the files are merged into one bundle and packed again. Any file that differs between IPSWs fails the build, and so does any file missing from one IPSW, unless it is an override file.

Each bundle is stored once in `obj/<sha256>` and normalized into its [profile](/wiki/pipeline/profiles). A bundle's **content id** (`cid`) is a SHA-256 over every file's path and SHA-256, so two archives of the same files have one content id however they were zipped. The release record names, per bundle, its hash, version, size and content id, and lists the build's modem packages with the phones each IPSW installs.

## The OTA manifest

The check compares the manifest's SHA-1 with the one last planned. A new manifest is stored at `ota/apple/manifests/<sha1>.plist` and becomes a unit.

The unit plans each file the manifest lists, within scope, whose record is missing or whose listings changed (the bundle name, OS version and model it is listed under). Each file is one step:

1. Download it over the scheme its URL names, then the other one. [IPCC § Hosts and paths](/wiki/ios/ipcc#hosts-and-paths) lists the hosts.
2. Check it against every digest the manifest states, SHA-1 and SHA-384.
3. Store it in `obj/`, normalize it, and write its record to `ota/apple/files/<sha256 of its URL>.json`.

A file that answers 4xx over both schemes, or whose bytes do not match a stated digest (Apple replaced it and kept the old digest), is left unheld, and the next manifest plans it again. A file Apple stops listing has its listings marked no longer live.

The manifest's SIM tables (`MobileDeviceCarriersByMccMnc` and the rest) become `routes` rows: which SIM rules send a SIM to which bundle ([Indexing](/wiki/pipeline/indexing)).

## Scope

| Platform | Read                                                                      |
| -------- | ------------------------------------------------------------------------- |
| iOS      | IPSWs: iPhones released since September 2023. OTA: every file             |
| iPadOS   | OTA only: each bundle's file for the newest OS it is listed for, no betas |
| watchOS  | the same                                                                  |

## See also

- [How carrier-explode works](/wiki/pipeline/overview)
- [Carrier Bundle § Image copies and OTA copies](/wiki/ios/carrier-bundle#image-copies-and-ota-copies)
- [IPSW File Format](https://theapplewiki.com/wiki/IPSW_File_Format) on The Apple Wiki
- [dwilliamsuk/ios-carrier-bundles](https://github.com/dwilliamsuk/ios-carrier-bundles): the IPSW extraction steps this site's are based on
