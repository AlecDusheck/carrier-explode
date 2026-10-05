---
title: PRI
searchTitle: "PRI files in iOS carrier bundles (CDMA era)"
description: "The plaintext .pri files in older carrier bundles - CDMA-era baseband settings as a property list, the sections in them, and carrier.prl."
updated: 2026-10-02
---

A **.pri** file is a set of baseband settings in a [carrier bundle](/wiki/ios/carrier-bundle), written as a plain XML property list. It is the older form of [.der.pri](/wiki/ios/der-pri) and is found in bundles for carriers that ran, or still run, CDMA, mostly in the US.

PRI is Qualcomm's name for a carrier's configuration: NV items and EFS files to load into the modem. The phones that use these files all have Qualcomm modems.

## Files

| File | Bundles | For |
|------|---------|-----|
| `carrier.pri` | 41 | every phone without a file of its own |
| `overrides_<boards>.pri` | many, for older boards | `N41_N42` (iPhone 5), `N48_N51`, `N48_N49_N51_N53` (5c, 5s), `N56_N61` (6 Plus, 6), `N66_N71` (6s Plus, 6s), `N69` (SE), `J72`-`J99a` (cellular iPads) |
| `carrier_ota.pri` | `Sprint_LTE_US`, `Sprint_Virgin_LTE_US` | ??? |
| `carrier.prl` | CDMA carriers | Preferred Roaming List, binary |

From the iPhone 6s on, a board's `.pri` comes with a `.der.pri` of the same revision, and later boards only have the `.der.pri`. `Nemont_US` 23.1 (iOS 9.2) has both for the 6s:

```
overrides_N66_N71.plist     DerPriFileName      overrides_N66_N71.der.pri
                            DerPriFileVersion   0.2.37
overrides_N66_N71.pri       PRI Revision        0.2.37
overrides_N66_N71.der.pri   (10 KB, signed)
```

and only `.pri` files for the iPhone 5c, 5s, 6 and 6 Plus. The `.der.pri` looks like the same settings compiled to the DER format and signed.

## Sections

From `Nemont_US` `carrier.pri`:

```
Maverick
    Carrier ID                          311NMT
    PRI Revision                        0.1.032
    Maverick SD Configuration Items     25 integers
NAM - General
    MDN                                 Default:000000[pESN4]
NAM - CDMA Settings
    Home SID/NID                        5320/65535, 31092/65535, 6206/65535, 0/0 ...
    MIN1                                Default:000[pESN4]
    MIN2                                Default:000
Security Grouping
    Service Programming Code Change Enabled     False
Feature Settings
    Preferred Mode                      Automatic
    OTAPA Enabled                       True
SMS / EMS Settings
    MO-SMS SO                           SO_6 (8k)
Data Parameters
    MIP Mode                            MIP Only
    MDR Mode                            MDR SO33
Carrier Configuration Management
    CDMA 1X Feature Group               [False, False, ...]
    EVDO Feature Group                  ...
CDMA
    SID-MCC Association Table           ...
    OTA Features                        ...
JCDMA
    Enable JCDMA                        False
EHRPD
GERAN
    A5 Algorithm Supported              A5_1
    GEA Algorithm Supported             GEA_1
WCDMA
Roaming Broker
```

`Carrier ID` is the same three-letter ID as in `MobileDeviceCarriersByCarrierID` in the [manifest](/wiki/ios/carrier-bundle-manifest#mobiledevicecarriersbycarrierid) (`311NMT` is Nemont). `Maverick` is ???; the name also turns up in the NV paths of current `.der.pri` files (`mav_...`) and in the `MAVZ` header.

Values like `Default:000000[pESN4]` look like templates filled in on the phone: here, presumably, an MDN of six zeros followed by the last four digits of the pseudo-ESN.

The per-board file can differ in more than the obvious ways. In the same bundle, `carrier.pri` sets the GSM ciphers to `A5_1` and `GEA_1`, while `overrides_N66_N71.pri` for the iPhone 6s sets `A5_3` and `GEA_3`.

## See also

* [.der.pri](/wiki/ios/der-pri)
* [.der.gri](/wiki/ios/der-gri)
* [Carrier Bundle](/wiki/ios/carrier-bundle)
