---
title: .der.pri
searchTitle: ".der.pri: iPhone baseband override files"
description: "Baseband override files in iOS carrier bundles: what they hold, the Qualcomm and Intel/Apple C1 formats, and how iOS sends them to the modem."
updated: 2026-10-02
---

A **.der.pri** file is a set of modem settings shipped inside a [carrier bundle](/wiki/carrier-bundle), one per group of phones (`overrides_D93_D94_D47_D48.der.pri`). iOS does not read it. CommCenter sends the whole file to the baseband, which applies it on top of its own defaults for that carrier.

PRI is Qualcomm's name for a carrier's configuration: a set of NV items and EFS files. `.der` is because the file is wrapped in ASN.1 DER.

Before `.der.pri` there were plaintext [PRI](/wiki/pri) files, and the [Default bundle](/wiki/default-bundle) has carrier-independent ones, [.der.gri](/wiki/der-gri), in the same format.

## Overrides plist

Every `.der.pri` is named from the overrides plist next to it:

```
DerPriFileName      overrides_D93_D94_D47_D48.der.pri
DerPriFileVersion   6.0.162
```

`DerPriFileVersion` matches the `PRI Revision` inside the file.

## Format

The file is a DER `SET` of context `[0]` records. Each record is a small DER document of its own, holding one setting:

```
SET (0x31)
    [0] (0x80)
        SEQUENCE
            9fa70c      EFS path        "/nv/item_files/data/3gpp/ds_3gpp_mtu"
            9fa70d      EFS value       96 05             (1430)
    [0]
        9f8732          NV 946          ...
    ...
```

Settings come in name/value pairs, and a pair never crosses a record. The tags are context-specific with high tag numbers. Two families of tags exist, one per modem vendor.

### Qualcomm

Used for phones with a Qualcomm modem: in `ATT_US` 72.1, the iPhone 12 to 16 families and the iPhone 17, 17 Pro and 17 Pro Max.

| Tag | What |
|-----|------|
| `9fa70c` / `9fa70d` | EFS path / file contents |
| `9fa711` / `9fa712` | setting name / value (older files) |
| `9fa708` | list of legacy NV item numbers in the file, uint16 little-endian |
| `9fa709` | index of every NV path the format knows about, zlib-compressed behind a `MAVZ` header (4 bytes, then the uncompressed length as uint32 LE) |
| `9fa710` | 2 bytes before the NV list, always `00 b2` (333 files) ??? |
| `9f8xxx` ... | a legacy NV item: the tag number is the NV item number. `9f8732` is tag 946, NV 946 |

The header gives `PRI Revision` and sometimes `Carrier ID` and `PRI Name`.

An EFS entry writes a whole file to the modem's filesystem. From `ATT_US` `overrides_D93_D94_D47_D48.der.pri` (iPhone 16 family), revision 6.0.162, 77 EFS entries:

```
/policyman/carrier_policy.xml                         <!-- Carrier policy XML for ATT ... -->
/data/3gpp/data_3gpp_dynamic_config.xml               <data_3gpp_dynamic_configuration> <carrier>ATT</carrier> ...
/nv/item_files/data/3gpp/ds_3gpp_mtu                  1430
/nv/item_files/modem/data/3gpp/ps/apn_reject/apn_reject_name.txt    reject_apn:ims;
/nv/item_files/ims/IMS_enable                         2
/nv/item_files/modem/nas/isr                          1
/nv/item_files/modem/lte/rrc/efs/disable_4l_per_band  <32 bytes>
/nv/item_files/modem/nas/mav_pssi_reg_unblock_hplmn_voice_not_avail_based_on_motion_st  1
```

`carrier_policy.xml` is the policyman file that decides which RATs and bands the modem may use on this carrier. Paths with `mav_` in them are Apple's own additions (`mav` for Maverick, Apple's name for its Qualcomm modem work ???).

The `MAVZ` index under `9fa709` lists 339 NV paths in this file. It is a list of what could be set, not what is set.

### Intel and Apple C1

Used for phones with an Intel modem (in `ATT_US` 72.1: the iPhone 11 family and the iPhone SE 2nd generation) and for Apple's own modems (iPhone 16e, iPhone Air, iPhone 17e). Apple kept Intel's format when it took over Intel's modem business.

| Tag | What |
|-----|------|
| `9fae70` / `9fae71` | setting name / value |
| `9fae72` / `9fae73` | NVM key / value |

Keys start with a type and end with a dotted path:

```
%u:dyn_cps.mm.t3525_val                                       300
%u:dyn_cps.mm.mm_ims_reg_timer                                300
%u:dyn_cps.errc.null_security_only_for_emergency_call         1
%u:dyn_cps.op_features.at_t_disable_geran_while_in_usa_mcc_enabled   1
%qu[16]:...                                                   16-byte string
%s[8]:...                                                     8-byte string
```

`%u:` is an unsigned integer, `%qu[N]:` an N-byte `label:value` string, `%s[N]:` an N-byte string. The last line above is from AT&T's file for the iPhone Air: AT&T tells its C1X modem to turn off GSM/EDGE while on a US network.

`ATT_US` `overrides_D23.der.pri` (iPhone Air) is revision 1.0.2 with 154 keys; `overrides_D79.der.pri` (SE 2nd generation, Intel) is 0.0.14 with 69.

## Delivery

For a Qualcomm modem, CommCenter copies the file over with a QMI file transfer (message `0xa000`), then activates it with PDC (Persistent Device Configuration). The code is `QMIBasebandSettingsDriver` in `libCommCenterMCommandDrivers.dylib`. How the Intel and C1 modems receive theirs is ???. The file is signed separately from the plist that names it: the bundle's `signatures/overrides_<boards>.plist` has `overrides_<boards>.der.pri2` (256 bytes) and `.der.pri3` (about 103 bytes) next to the plist's own `CBSignature2` and `CBSignature3`. Whether the modem checks these itself is ???.

## MVNO files

`TMobile_US` is the only bundle with a second set, `overrides_mvno1_<boards>.der.pri`, one for each of its boards. Which SIMs get them is ???.

## See also

* [PRI](/wiki/pri)
* [.der.gri](/wiki/der-gri)
* [Carrier Bundle](/wiki/carrier-bundle)
* [Bundle Selection](/wiki/bundle-selection)
* [Self-registration](/wiki/china-self-registration)
