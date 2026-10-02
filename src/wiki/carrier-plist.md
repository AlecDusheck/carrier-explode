---
title: Carrier.plist
searchTitle: "carrier.plist keys, APN type-mask and oddities"
description: "The main settings file of a carrier bundle today: the common keys, the modern APN type-mask bits, and the strange values in current bundles."
updated: 2026-10-02
---

<script>
  import Bundle from "#lib/components/wiki/Bundle.svelte";
  import Setting from "#lib/components/wiki/Setting.svelte";
  import SettingTable from "#lib/components/wiki/SettingTable.svelte";
</script>

**carrier.plist** is the main settings file of a [carrier bundle](/wiki/carrier-bundle). The [Apple Wiki page](https://theapplewiki.com/wiki/Carrier.plist) documents it as of iOS 3 and 4. This page covers the current bundles: the newest copy of each of the <Setting path="CarrierName" show="scanned" /> carrier bundles this site holds. Numbers in tables marked *live* are read from those bundles when the page is loaded; the rest were counted in October 2026, when the bundles used 318 different top-level keys.

Per-phone `overrides_*.plist` files and MVNO configurations use the same keys; see [Bundle Selection](/wiki/bundle-selection).

## Common keys

The most used top-level keys, with the number of bundles that set them:

| Key | Bundles (live) | Notes |
|-----|---------|-------|
| `SupportedSIMs` | <Setting path="SupportedSIMs" /> | see [Bundle Selection](/wiki/bundle-selection#sim-to-bundle) |
| `CarrierName` | <Setting path="CarrierName" /> | |
| `apns` | <Setting path="apns" /> | see [APNs](#apns) |
| `SupportsNITZ` | <Setting path="SupportsNITZ" /> | about half true, half false |
| `MaxBluetoothModemConnections` | <Setting path="MaxBluetoothModemConnections" /> | 5 in every bundle that sets it |
| `PhoneNumberRegistrationGatewayAddress` | <Setting path="PhoneNumberRegistrationGatewayAddress" /> | FaceTime/iMessage SMS registration number |
| `ShowDialAssist` | <Setting path="ShowDialAssist" /> | |
| `HomeBundleIdentifier` | <Setting path="HomeBundleIdentifier" /> | the country bundle, e.g. `com.apple.UnitedStates` |
| `OTASoftwareUpdate` | <Setting path="OTASoftwareUpdate" /> | |
| `StatusBarImages` | <Setting path="StatusBarImages" /> | |
| `VisualVoicemailServiceName` | <Setting path="VisualVoicemailServiceName" /> | `none`, `IMAP`, and twice `None` |
| `AttachAPN` | <Setting path="AttachAPN" /> | the APN used to attach to LTE/5G |
| `IMSConfig` | <Setting path="IMSConfig" /> | VoLTE, Wi-Fi Calling, SMS over IMS |
| `MMS` | <Setting path="MMS" /> | |
| `MyAccountURL` | <Setting path="MyAccountURL" /> | |
| `Services` | <Setting path="Services" /> | carrier services menu in Settings > Phone |
| `EmergencyCalling` | <Setting path="EmergencyCalling" /> | |
| `CarrierEntitlements` | <Setting path="CarrierEntitlements" /> | Wi-Fi Calling and eSIM entitlement server |
| `CellBroadcast` | <Setting path="CellBroadcast" /> | mostly in country bundles |
| `RemoteCardProvisioningSettings` | <Setting path="RemoteCardProvisioningSettings" /> | eSIM |

`PhoneNumberRegistrationGatewayAddress` is `+447786205094` in 251 bundles. The Apple Wiki gives `28818773` for the US and Canada; only 12 bundles still use it.

### IMSConfig

`IMSConfig` is the biggest dictionary in most modern bundles. Its sections, by number of bundles: `Voice` (464), `Signaling` (443), `Media` (429), `XCAP` (417), `ConferenceCalling` (367), `SMS` (366). `Signaling.SipTimers` overrides the SIP timers from RFC 3261, in milliseconds.

`IMSConfig.ConferenceCalling.conferenceServer` is usually the 3GPP default, `sip:mmtel@conf-factory.ims.mnc<MNC>.mcc<MCC>.3gppnetwork.org`. Some bundles leave the template unfilled: `Hutchison_Wind_it` has `mnc${MNC}.mcc${MCC}`, `CW_wi` `mnc${mnc}.mcc${mcc}` with a trailing space, and `Telia_se` leaves out the `sip:`.

## APNs

Each entry in `apns` has an `apn`, `username`, `password` and a `type-mask` saying what the APN is for. The type-mask table on the Apple Wiki was already marked out of date for iOS 4. The bits below are inferred from the names of the 1,656 APNs in the current bundles, by looking at which APN names carry each bit and which bits appear on their own:

| Bit | Value | APNs with it | Use |
|-----|-------|--------------|-----|
| 0 | `0x1` | 626 | data |
| 1 | `0x2` | 151 | visual voicemail (alone on `vvm...` APNs) |
| 2 | `0x4` | 411 | MMS (240 of them alone, mostly `mms`) |
| 4 | `0x10` | 808 | tethering. Alone only on `hotspot` and `firstnethotspot` |
| 5 | `0x20` | 804 | tethering. Never alone; always with `0x10` |
| 13 | `0x2000` | 2 | device setup (`devicesetup`, Verizon `aplbootvzwen`) |
| 15 | `0x8000` | 183 | ??? (always with data) |
| 16 | `0x10000` | 14 | ??? (eSIM data-only providers: GigSky, Global Data) |
| 17 | `0x20000` | 231 | IMS. Always alone; 230 of the APNs are named `ims` |
| 18 | `0x40000` | 83 | emergency (`sos`, `emergency`). Always alone |
| 19 | `0x80000` | 2 | device setup, with `0x2000` |
| 20 | `0x100000` | 180 | XCAP / Ut, supplementary services (`hos`, `xcap`) |

`0x30` (48) for tethering is the same as in iOS 3. Bits 3, 6, 9 and 12 each appear on two to four APNs. ???

Newer entries also have `tech-type-mask`, `AllowedProtocolMask`, `AllowedProtocolMaskInRoaming`, `AlwaysOnPDU`, `UseNetworkMTU` and `NoCellularReconnectCauseCodes`.

Many APN passwords are not secret and are the same for every customer: `beeline` (VimpelCom_ru), `mts` (MTS_by), `t-mobile` (TMobile_mk), `wap` (Talkmobile_uk, Digicel_tt), `data` (Safaricom_ke).

### MMS proxies

The `MMS.Proxy` of most carriers outside the US is an address inside the carrier's own network. A few are memorable:

```
MTS_by              192.168.192.168:8080
Ice_no              10.10.10.10:80
Swisscom_Wingo_ch   192.168.210.002:8080      (leading zeros)
MTN_cy              172.24.97.1:3130
```

## Oddities

Things in the current bundles that look like mistakes, leftovers or one-offs.

### Typos and placeholders

* The enhanced 911 block in <Bundle name="StrataNetwork_LTE_US" /> is spelled `Lcoation`:
```
Lcoation.EmergencyLocation.AugmentedEmergencyAction.Supplemented911.HTTPS.URL   meridian.cdn-apple.com/location
```
Spelled `Location`, the same setting is in <Setting path="Location.EmergencyLocation.AugmentedEmergencyAction.Supplemented911.HTTPS.URL" /> other bundles (*live*). Unless something reads the misspelling, this one does nothing.
* There is a key named `Key New` with the value `Value` in <Bundle name="Vodafone_Travel" />.
* `Sprint_ISIM_LTE_US` and `Sprint_Boost_ISIM_LTE_US` have `ResetSIMProvisoning`.
* `USCellular_LTE_US` has a cell broadcast alert type named `Test`, and `ATT_FirstNet_US` lists `Test` in `EmergencyCalling.IgnoreEENLSubServiceFields`.
* `CarrierLab` points XCAP at `bsf.test.3gpp.com`; `Vodafone_qa` uses the push topic `qa.com.vodafone.watch.test.entitlement`.

### Extreme values

The bundle with the largest value of a numeric setting, against the median of every bundle that sets it (*live*):

<SettingTable rows={[
  { path: "MMS.MaxSlidesPerMessage" },
  { path: "MMS.MaxSMILDuration" },
  { path: "MMS.MaxMessageSize", note: "bytes" },
  { path: "IMSConfig.Signaling.SipTimers.B", note: "milliseconds; RFC 3261 default 32000" },
  { path: "IMSConfig.Media.InactivityTimerRTCPSeconds" },
  { path: "IMSConfig.Signaling.LocalQoSTimeoutMOSeconds" },
  { path: "RemoteCardProvisioningSettings.ActivatingStateSubscriptionCheckTimerIntervals[*]" },
  { path: "apns[*].NoCellularReconnectCauseCodes[*].NumTriesAllowed" },
  { path: "IMSConfig.Signaling.EmergencyCallBackModeExpirationSeconds", scope: "countries" },
  { path: "MaxMultiPartyCalls" },
]} />

2147483647 is the largest signed 32-bit integer.

### Only one bundle disagrees

Settings that 40 or more bundles set, where exactly one bundle has the other value:

* Afghanistan's <Bundle name="Etisalat_af" /> is the only one of 73 bundles where `CellBroadcast.AlertTypes.Presidential.UserConfigurable` is true: Afghan users can turn off presidential alerts. It also has its own alert names, `Extreme Threats`, `Severe threats` (lower case) and `AMBER alerts`.
* `EMT_ee` is the only one of 139 with `SupportsOnDevicePhysicalSIMConvert` false.
* `Vodafone_tr` is the only one of 148 with `SupportPhysicalSIMtoESIMTransfer` false.
* `Mobifone_vn` is the only one of 246 with `TechSettings.IKE.NATTKeepAliveOffload` false.
* `StrataNetwork_LTE_US` is the only one of 321 with `IMSConfig.Signaling.RequirePreconditionsWhenMandatory` true.
* `Inland_LTE_US` is the only one of 166 with `EnableLTEAfterUpgrade` false.
* `Default` is the only one of 259 with `ShowWiFiCallingWarningUnsupportedCarrier` true.

### Keys only one bundle has

| Key | Bundle | Value |
|-----|--------|-------|
| `ShowIMEIsInLockScreen` | `SaudiArabia` | true |
| `HomeSatelliteSystemName` | `KDDI_UQ_NR_jp` | `SpaceX UQ mobile` |
| `InterCarrierRoamingDisplayNames` | `China` | `46021` shows both `中国电信` and `中国移动`, pipe-separated; seven more pairs |
| `SuppressUIIndicatorWhenInternetDown` | `Japan` | true |
| `BookmarkURLs` | `True_th` | `TrueLife`, `http://iphone.truelife.com` |
| `VoicemailPilotName` | `Digicel_pg` | `555` |
| `AutoCallPickupTimer` | `Verizon_Charter_LTE_US` | 25 |
| `SaveICCIDToCache` | `ChinaTelecom_USIM_cn` | true |
| `DefaultInternetSNSSAI` | `Vodafone_uk` | |
| `DataOnlySubscription` | `Telefonica_eSimFLAG` | |
| `Show3GSwitchOnCat10HW` | `ATT_Defense_US` | false |

`PreventWiFiHandoverInEmergency` is set only by `Verizon_LTE_US` and `Verizon_MVNO_US`. `AllowFaceTimeOverCellular` only by `CMCC_cn` and `CBN_cn`. `IllinoisValley_US` and `SilverStar_US` prefix international SMS with `+011`. KDDI's two `_NR_` bundles are the only ones with satellite settings (`SupportsSatellite`, `SatelliteApps`, `SatelliteAccessInfo`).

`StockSymboli`, the Stocks app key from iOS 1, is still in a dozen bundles (`Telus_ca`, `Rogers_ca`, `Telia_se`, `Telenor_no`, ...). `Sprint_CSIM_LTE_US` uses it to add `TMUS` to Stocks.

## See also

* [Carrier Bundle](/wiki/carrier-bundle)
* [Bundle Selection](/wiki/bundle-selection)
* [Carrier.plist](https://theapplewiki.com/wiki/Carrier.plist) on The Apple Wiki
