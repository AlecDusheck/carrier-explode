---
title: Self-registration
searchTitle: "Self-registration: Chinese carrier device reporting"
description: "How Chinese carrier device self-registration shows up in iOS: terminal-registration SMS in carrier bundles and ds_autoreg in Qualcomm modem firmware."
updated: 2026-10-02
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
  import Setting from "#lib/components/wiki/Setting.svelte";
</script>

**Self-registration** (自注册) is a Chinese carrier requirement that a device report its own identity to the network the first time it is used: at least its model, IMEI/MEID and the SIM's ICCID/IMSI. iOS carries two unrelated implementations of it: a terminal-registration SMS driven from a [carrier bundle](/wiki/ios/carrier-bundle), and an `autoreg` client built into the Qualcomm modem firmware.

## Terminal-registration SMS

Only the China Telecom bundles carry it: <Bundle name="ChinaTelecom_cn" />, <Bundle name="ChinaTelecom_USIM_cn" /> and `ChinaTelecom_mo` (Macau). The keys live under `SMSSettings.TerminalRegistration` in [carrier.plist](/wiki/ios/carrier-plist), read by `libCellularDecoders.dylib` (`getTermCarrierSettings`). From `ChinaTelecom_USIM_cn`:

```
SMSSettings.TerminalRegistration.DestinationAddress     10659401
SMSSettings.TerminalRegistration.TeleserviceID          65005
SMSSettings.TerminalRegistration.Registration           <a1><b1>ACM-$MODEL</b1><b2>$MEID</b2><b3>$IMSI</b3><b4>$VERSION</b4></a1>
SMSSettings.TerminalRegistration.RegistrationOverIMS     <a1><b1>ACM-$MODEL<b2>$MEID<b3>$MEID2<b4>$IMSI<b5>$VERSION</a1>
```

iOS sends a CDMA-teleservice SMS to `10659401` with the template filled in: `$MODEL`, `$MEID` (and `$MEID2` for the second SIM), `$IMSI` and `$VERSION` are substituted. `RegistrationOverIMS` is the same payload for when the message goes over IMS rather than legacy CDMA. The `ACM-` prefix is ???.

`ChinaTelecom_cn` additionally sets `AllowedMultimodeSIMs.Config.OverrideConfiguration.SMSSettings.TerminalRegistration` to `False`, presumably turning the SMS off for multimode (CT + other operator) SIMs.

Two more China Telecom keys relate to reporting the device to the carrier:

| Key                                              | Bundle                 | Note                                                                                                     |
| ------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `SaveICCIDToCache`                               | `ChinaTelecom_USIM_cn` | caches the ICCID; the only bundle that sets it                                                           |
| `CarrierEntitlements.SendSelfRegistrationUpdate` | `ChinaTelecom_USIM_cn` | "Send self-registration updates to the entitlement server", per CommCenter; the only bundle that sets it |

The custom teleservice IDs next to them (`SMSSettings.CustomTeleserviceIDs.FDEA = 1004`, `FDED = 1002`) are set in all four China Telecom bundles.

Other China bundles (<Bundle name="CMCC_cn" />, <Bundle name="Unicom_cn" />, <Bundle name="CBN_cn" />) have no terminal-registration keys. Their many `*Registration*` keys are SIP (IMS) registration and FaceTime/iMessage `PhoneNumberRegistrationGatewayAddress`, which are unrelated.

## Modem auto-registration (`ds_autoreg`)

Every Qualcomm modem firmware package carries a carrier self-registration client of its own, separate from anything in a bundle. It is the firmware module `ds_autoreg.c`, inside `qdsp6sw.mbn`, present in `Mav20` through `Mav30` (iPhone 12 through iPhone 17 and the third-generation SE) and absent from the Intel `ICE19` and the Apple `C1`/`c4020` packages. `Mav22` to `Mav25` also have a `cmautoreg.c`.

The client is configured through EFS files under `/data/autoreg/`, written by the modem rather than by a `.der.pri`:

```
/data/autoreg/feature_disable
/data/autoreg/user_consent
/data/autoreg/dynamic_carrier_enable
/data/autoreg/carrier                 ct | cm | cu
/data/autoreg/server
/data/autoreg/iccid
/data/autoreg/json_report.json
/data/autoreg/json_report_cmcc.json
/data/autoreg/json_report_cu.json
```

In `Mav22` to `Mav25` it can be switched off from NV: `/nv/item_files/modem/mmode/disable_autoreg`. `Mav20`, `Mav21` and `Mav30` have no such item. ???

The report is JSON (fields `MODEL`, `IMEI1`/`IMEI2`, `MEID`, `SIM1ICCID`, `S1LTEIMSI`, `REGVER` and so on), and the `carrier` value picks the dialect and endpoint. Three endpoints are compiled into the firmware:

```
http://zzhc.vnet.cn:%d       China Telecom (vnet.cn is China Telecom)
http://dm.wo.com.cn:%d       China Unicom (wo.com.cn is Unicom's "WO" brand)
coap://m.fxltsbl.com:%d      ???
```

`json_report_cmcc.json` is the China Mobile dialect and `json_report_cu.json` the China Unicom one. These strings are in the compressed `qdsp6sw.mbn` code image, so they are not in a [baseband](/ios/builds/24A446/Mav24) package's file list on this site.

## zzhc

ZZHC is pinyin: **Zi-ZHu-Ce**, 自注册, self-registration. It is the name of the host in `zzhc.vnet.cn`, China Telecom's self-registration server, which the `ds_autoreg` client above reports to for China Telecom SIMs. Nordic's nRF Connect SDK has a public implementation for its cellular IoT modules, the [China Telecom ZZHC library](https://nrfconnectdocs.nordicsemi.com/ncs/latest/nrf/libraries/modem/zzhc.html), which uploads the IMEI, model, modem revision, ICCID and IMSI to the same server when it sees a new SIM, citing chapter 6 of China Telecom's IoT module requirements.

The literal string `zhcc` does not appear in any modem package; the firmware token is `zzhc`.

## China SKU flag

The Qualcomm [.der.gri](/wiki/ios/der-gri) files in the [Default bundle](/wiki/ios/default-bundle), and the firmware itself, write `/nv/item_files/modem/mav/mav_china_sku_nal_supp`. It is a China-SKU hardware flag (`NAL` ???) and is presumably unrelated to self-registration.

## See also

- [Carrier Bundle](/wiki/ios/carrier-bundle)
- [Carrier.plist](/wiki/ios/carrier-plist)
- [.der.pri](/wiki/ios/der-pri)
- [.der.gri](/wiki/ios/der-gri)
