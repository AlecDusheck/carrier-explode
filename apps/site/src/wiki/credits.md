---
title: About
searchTitle: "About carrier-explode: data sources and credits"
description: "Where the carrier settings on this site come from and how often each source is checked, the references used to name and sort them, prior art, and the source of every carrier logo."
updated: 2026-10-07
---

**carrier-explode** decodes the carrier settings that ship in iPhone, Pixel and Galaxy firmware and compares them. Everything here was built on other people's work.

**Contributors:** [Alec Dusheck](https://dusheck.com).

## Data sources

Times are UTC.

### Apple

| Source                                                               | What is read                                                                                       | Checked          |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| [ipsw.me](https://ipsw.me)                                           | the iPhone restore images (IPSWs): the carrier and country bundles in each, and its modem firmware | every 20 minutes |
| [AppleDB](https://appledb.dev)                                       | beta builds, and each device's boards, release day and name                                        | every 20 minutes |
| Apple's [carrier bundle manifest](/wiki/ios/carrier-bundle-manifest) | the bundles Apple publishes over the air, and the tables that send a SIM to one                    | every 6 hours    |

IPSWs are read for every iPhone released since September 2023. Every build from 5 October 2026 is read; of earlier builds, every release and the newest major version's betas. iPad and Apple Watch bundles come only from the manifest: each bundle's file for the newest OS version it is listed for, without betas. Apple, iOS, iPhone, iPad and Apple Watch are trademarks of Apple Inc.

### Google Pixel

| Source                                                                         | What is read                                                                                                                                | Checked       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| [Android OTA images](https://developers.google.com/android/ota)                | each Pixel's full OTA image: its [CarrierSettings](/wiki/android/carrier-settings) and its [modem configuration](/wiki/android/pixel-modem) | daily, 03:35  |
| [Build numbers](https://source.android.com/docs/setup/reference/build-numbers) | builds the OTA page no longer lists, which date each Pixel's first build                                                                    | daily, 03:35  |
| Google's carrier settings update service                                       | the carrier settings files Google publishes for each Pixel after a build ships                                                              | every 6 hours |

OTA images are read for every Pixel released since October 2020. Every build from 5 October 2026 is read; of earlier builds, each Pixel's last build of each quarterly release. Android setting names and descriptions come from the CarrierConfigManager javadoc in the [Android Open Source Project](https://source.android.com). Pixel, Android and Google are trademarks of Google LLC.

### Samsung Galaxy

| Source                                                                                              | What is read                                                                                                                              | Checked          |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [Google Play's supported devices](https://storage.googleapis.com/play_public/supported_devices.csv) | the US Galaxy models and their names                                                                                                      | every 20 minutes |
| Samsung's `version.xml`                                                                             | each model's builds                                                                                                                       | every 20 minutes |
| Samsung's firmware update server (FUS)                                                              | the firmware itself: its [carrier packs](/wiki/samsung/carrier-pack), IMS settings and [modem configurations](/wiki/samsung/galaxy-modem) | each new build   |

Firmware is read for the US Galaxy S, Z Fold and Z Flip models (`U` and `U1`, FE models aside) launched since January 2025: of each of the three newest Android versions, each model's newest build, on each family's newest generation that has it. Samsung offers a model's current firmware, not an archive of past builds, so a Galaxy's history here starts when this site began reading it. Samsung and Samsung Galaxy are trademarks of Samsung Electronics Co., Ltd.

### Names and references

- **Device names** come from AppleDB, Google's OTA page and FUS.
- **Modem chips.** A Galaxy's Qualcomm firmware names only its chipset; `KAANAPALI` is labelled Qualcomm X85 after [PhoneDB](https://phonedb.net/index.php?m=processor&id=1055&c=qualcomm_snapdragon_8_elite_gen_5_sm8850-1-ad_for_galaxy__kaanapali).
- **Codes no source names** (a device, a carrier bundle, a modem family) are named weekly by a language model from a web search, which keeps the page it read the name on.
- **Countries.** A SIM's country is its MCC's, by [ITU-T E.212](https://www.itu.int/rec/T-REC-E.212); country names are ISO 3166's, from ICU.
- **Test SIMs.** Rules on an MCC E.212 assigns to no network (those starting 0, 1 or 8, and 999), and on 246 081, the network [3GPP TS 31.121](https://www.3gpp.org/DynaReport/31121.htm) conformance tests simulate, are shown as test networks and never link two carriers.

## Prior art

These projects worked out how carrier files are fetched, extracted and read before this site did.

- [dwilliamsuk/ios-carrier-bundles](https://github.com/dwilliamsuk/ios-carrier-bundles): the IPSW extraction steps.
- [mast3rz3ro/imobilecfbm](https://github.com/mast3rz3ro/imobilecfbm), [mrlnc/ipcc-downloader](https://github.com/mrlnc/ipcc-downloader) and [samsam123.name.my/ipcc](https://samsam123.name.my/ipcc/): downloaders over the same manifest.
- [The Apple Wiki: Carrier Bundle](https://theapplewiki.com/wiki/Carrier_Bundle).
- [blacktop/go-apfs](https://github.com/blacktop/go-apfs): reading an IPSW's filesystem.
- [GrapheneOS/adevtool](https://github.com/GrapheneOS/adevtool): the request to Google's carrier settings update service.
- [zacharee/SamloaderKotlin](https://github.com/zacharee/Bifrost) (now Bifrost, MIT): the FUS client, ported.
- [fei-ke/OmcTextDecoder](https://github.com/fei-ke/OmcTextDecoder) (Apache-2.0): decoding Samsung's encoded pack files.
- [JohnBel/EfsTools](https://github.com/JohnBel/EfsTools) and [fenrir-naru/mbn_utils](https://github.com/fenrir-naru/mbn_utils) for Qualcomm EFS and NV names, and 3GPP TS 23.041 and 3GPP2 C.S0016 for the spec-defined formats.

## Images

- **Phone drawings.** The iPhone and Pixel outlines are drawn for this site from shapes measured on Apple's images ([Apple's iPhone comparison](https://www.apple.com/iphone/compare/) and [Apple's iPhone identification guide](https://support.apple.com/108044)) and Google's own images. The Galaxy outline is a plain shape, not measured on any Galaxy.
- **Version marks.** The iOS and Android release icons are drawn for this site and coloured after each release's own branding. Galaxy firmware takes its Android release's mark.
- **File-type icons** and the site icon are drawn for this site.

## Carrier logos

Carrier names and logos are trademarks of their owners. They are shown only to say which carrier a bundle belongs to; this site is not affiliated with or endorsed by any of them.

### Redrawn

| Carrier                                                                   | Source                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 2degrees (New Zealand)                                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:2d_logo.svg)                                          |
| Afghan Wireless Communication Company (AWCC)                              | [Wikipedia](https://en.wikipedia.org/wiki/File:Afghan_Wireless_logo_Oct_2017.png)                                 |
| Alaska Communications (ACS)                                               | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Alaska_Communications_logo.svg)                       |
| Alfa (Lebanon)                                                            | [Wikipedia](https://en.wikipedia.org/wiki/File:Logo_Alfa_Telecom_%28Lebanon%29.png)                               |
| Algar Telecom                                                             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Algar_Telecom_logo.svg)                               |
| Aliv (NewCo15 Limited / Cable Bahamas)                                    | [Company website](https://bealiv.com/)                                                                            |
| Almadar Aljadid (Libya)                                                   | [Company website](https://almadar.ly/)                                                                            |
| Altel                                                                     | [Company website](https://tele2.kz/)                                                                              |
| American Samoa Telecommunications Authority (ASTCA / Bluesky)             | [Company website](https://bluesky.as/)                                                                            |
| Andorra Telecom                                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Andorra_Telecom_2019_logo.svg)                        |
| ANTEL (Administración Nacional de Telecomunicaciones), Uruguay            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Antel.svg)                                            |
| Appalachian Wireless                                                      | [Company website](https://appalachianwireless.com/)                                                               |
| APUA (Antigua and Barbuda Public Utilities Authority)                     | [Company website](https://apua.ag/)                                                                               |
| ATN International                                                         | [Company website](https://atni.com/)                                                                              |
| ATOM Myanmar                                                              | [Company website](https://atom.com.mm/)                                                                           |
| Azercell Telecom LLC                                                      | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Azercell_logo.svg)                                    |
| Bakcell                                                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:BKC_Logo_Icon.png)                                    |
| Banglalink                                                                | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Banglalink_Logo_2025.svg)                             |
| Batelco (Batelco by Beyon), Bahrain                                       | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Batelco_By_Beyon_logo.svg)                            |
| Bharat Sanchar Nigam Limited (BSNL)                                       | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:BSNL_Eng_Logo_n_png.png)                              |
| Bhutan Telecom                                                            | [Wikipedia](https://en.wikipedia.org/wiki/File:Bhutan_Telecom_logo.png)                                           |
| BIGLOBE (BIGLOBE Inc.)                                                    | [Company website](https://biglobe.co.jp/)                                                                         |
| Bitė (Bitė Group)                                                         | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:BITĖ_Group_Logo.svg)                                  |
| Bluesky Communications (Bluesky Pacific Group)                            | [Company website](https://bluesky.as/)                                                                            |
| bmobile (TSTT)                                                            | [Company website](https://bmobile.co.tt/)                                                                         |
| Botswana Telecommunications Corporation (beMobile)                        | [Company website](https://btc.bw/)                                                                                |
| Bravado Wireless                                                          | [Company website](https://bravadowireless.com/)                                                                   |
| BTC Bahamas (The Bahamas Telecommunications Company)                      | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:BTC-Logo-2023.png)                                    |
| C Spire                                                                   | [Company website](https://cspire.com/)                                                                            |
| Cable &amp; Wireless Seychelles                                           | [Company website](https://cwseychelles.com/)                                                                      |
| Cablenet                                                                  | [Company website](https://cablenet.com.cy/)                                                                       |
| Carolina West Wireless                                                    | [Company website](https://carolinawest.com/)                                                                      |
| Cell C                                                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Cell_C_New_2024_logo.svg)                             |
| Cellcard (CamGSM Co. Ltd.)                                                | [Company website](https://cellcard.com.kh/)                                                                       |
| Cellcom (New-Cell)                                                        | [Company website](https://cellcom.com/)                                                                           |
| China Mobile                                                              | [Wikipedia](https://en.wikipedia.org/wiki/File:China_Mobile_logo_%282019%29.svg)                                  |
| China Telecom                                                             | [Wikipedia](https://en.wikipedia.org/wiki/File:China_Telecom_Logo.svg)                                            |
| China Unicom                                                              | [Wikipedia](https://en.wikipedia.org/wiki/File:China_Unicom_logo_%282022%29.svg)                                  |
| Chunghwa Telecom                                                          | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Chunghwa_Telecom.svg)                                 |
| CNT (Corporación Nacional de Telecomunicaciones CNT EP)                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:CNT_Logo.svg)                                         |
| CREDO Mobile                                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:CREDO_Mobile_logo.svg)                                |
| CTM (Companhia de Telecomunicações de Macau)                              | [Company website](https://ctm.net/)                                                                               |
| Cyta (Cyprus Telecommunications Authority)                                | [Wikipedia](https://en.wikipedia.org/wiki/File:Revised_Cyta_Logo,_adopted_22_October_2024.jpg)                    |
| Dhiraagu (Dhivehi Raajjeyge Gulhun Pvt Ltd)                               | [Wikipedia](https://en.wikipedia.org/wiki/File:Dhiraagu_logo.svg)                                                 |
| Dialog Axiata                                                             | [Company website](https://dialog.lk/)                                                                             |
| Digitel (Corporación Digitel)                                             | Company website                                                                                                   |
| Djezzy                                                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Djezzy_Logo_2015.svg)                                 |
| Eastlink                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Eastlink_Logo.svg)                                    |
| Econet Wireless Zimbabwe                                                  | [Company website](https://econet.co.zw/)                                                                          |
| Emirates Integrated Telecommunications Company (du)                       | [Wikipedia](https://en.wikipedia.org/wiki/File:Du_Solid_Brandmark_RGB.png)                                        |
| Epic (Epic Ltd)                                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Epic_logo.png)                                        |
| eSIM Go                                                                   | [Company website](https://esim-go.com/)                                                                           |
| ETB (Empresa de Telecomunicaciones de Bogotá)                             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:ETB_Bogotá_logo.svg)                                  |
| Faroese Telecom (Føroya Tele P/f)                                         | [Company website](https://ft.fo/)                                                                                 |
| FL1 (Telecom Liechtenstein)                                               | [Company website](https://fl1.li/)                                                                                |
| Flexiroam eSIM                                                            | [Company website](https://flexiroam.com/)                                                                         |
| Free Mobile (Iliad)                                                       | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo-free-mobile2022.png)                             |
| Freedom Mobile                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Freedom_Mobile_2025_logo.svg)                         |
| freenet AG                                                                | [Wikipedia](https://en.wikipedia.org/wiki/File:Freenet_Logo_2022.svg)                                             |
| FSM Telecommunications Corporation                                        | [Company website](https://fsmtc.fm/)                                                                              |
| GCI (General Communication Inc.), Alaska                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:GCI_logo.svg)                                         |
| giffgaff                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Giffgaff_logo.svg)                                    |
| GigSky                                                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:GigSky_website_logo2.jpg)                             |
| Glo (Globacom)                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Glo_button.png)                                       |
| GO (Malta)                                                                | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:GO_Logo.svg)                                          |
| Golan Telecom                                                             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:GolanTelecomNew.png)                                  |
| Grameenphone                                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Grameenphone_Logo_GP_Logo.svg)                        |
| ho. Mobile (Fastweb S.p.A.)                                               | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ho-mobile_logo.svg)                                   |
| Holafly eSIM                                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Holafly-logo.svg)                                     |
| Ice (Ice Norge)                                                           | [Company website](https://ice.no/)                                                                                |
| iD Mobile                                                                 | [Wikipedia](https://en.wikipedia.org/wiki/File:ID_Updated_Logo.png)                                               |
| Iliad                                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Iliad_logo.svg)                                       |
| Imagine (Imagine Broadband)                                               | [Company website](https://imagine.ie/)                                                                            |
| Indosat Ooredoo Hutchison                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Indosat_Ooredoo_Hutchison.svg)                        |
| Inland Cellular                                                           | [Company website](https://inlandcellular.com/)                                                                    |
| inwi (Wana Corporate)                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo_inwi.svg)                                        |
| IPKO (Kosovo)                                                             | [Wikipedia](https://en.wikipedia.org/wiki/File:IPKO_logo.svg)                                                     |
| J:COM (Jupiter Telecommunications Co.)                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Jupiter_Telecommunications_logo.svg)                  |
| Jazztel                                                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Jazztel.svg)                                          |
| Kcell                                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Kcell_wordmark.svg)                                   |
| Kena Mobile                                                               | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Kena_Mobile_logo_%282017-present%29.svg)              |
| KKTCell (Kuzey Kibris Turkcell)                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Turkcell_Kuzey_Kıbrıs_Logo.png)                       |
| KnowRoaming                                                               | [Company website](https://knowroaming.com/)                                                                       |
| Koodo Mobile                                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Koodo_logo.svg)                                       |
| KORE Wireless                                                             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:KORE_Wireless_company_logo.svg)                       |
| KPN (Royal KPN)                                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo_kpn.svg)                                         |
| KT Corporation                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:KT_Corp_2D_logo.svg)                                  |
| Kyivstar                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Kyivstar_logo.svg)                                    |
| Kölbi (ICE)                                                               | [Company website](https://kolbi.cr/)                                                                              |
| Lao Telecom                                                               | [Company website](https://laotel.com/)                                                                            |
| Lebara Mobile                                                             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Lebara_2026.svg)                                      |
| LG Uplus                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:LG_U+_CI.svg)                                         |
| life: (Life), Belarusian Cloud Technologies / Turkcell Belarus            | [Company website](https://life.by/)                                                                               |
| lifecell (Ukraine)                                                        | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Lifecell_2016_logo_-_Wordmark.svg)                    |
| LotusFlare                                                                | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Lotusflare_logo.svg)                                  |
| Lowi (Vodafone Espana)                                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Lowi_2025_Logo.svg)                                   |
| Lucky Mobile                                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Lucky_Mobile_logo.png)                                |
| M1 Limited (Singapore)                                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:M1_Singapore_2020.svg)                                |
| MagtiCom (Magti), Georgia                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Magti-_2020-logo.jpg)                                 |
| Manx Telecom (Isle of Man)                                                | [Company website](https://manxtelecom.com/)                                                                       |
| Maroc Telecom (IAM)                                                       | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Maroc_Telecom_logo.png)                               |
| Mascom Wireless                                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Mascom_logo.png)                                      |
| Maxis (Maxis Communications Berhad)                                       | [Company website](https://maxis.com.my/)                                                                          |
| MegaFon                                                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:MegaFon_logo_Russian.svg)                             |
| Melita                                                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:01_Melita_Primary_Logo_Full_Colour_Off-Black_RGB.svg) |
| MEO (Altice Portugal)                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo_MEO.svg)                                         |
| Metfone (Viettel Cambodia)                                                | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:The_Metfone_Logo.png)                                 |
| Metro by T-Mobile                                                         | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Metro_By_T-Mobile_2022.svg)                           |
| Mint Mobile                                                               | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Mint_Mobile_Logo.svg)                                 |
| Mobicom Corporation                                                       | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Mobicomnewlogo.png)                                   |
| MobiFone                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:MobiFone_logo.svg)                                    |
| Mobilis (ATM Mobilis)                                                     | [Company website](https://mobilis.dz/)                                                                            |
| Mobily (Etihad Etisalat Company)                                          | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Mobily_Logo.svg)                                      |
| Moldcell                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Moldcell.png)                                         |
| Monaco Telecom                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo-2-ligne-rouge-clean.png)                         |
| Moov Africa                                                               | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Moov_Africa.jpg)                                      |
| Movistar (Telefónica)                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Movistar_isotype_2025.png)                            |
| MTA (Matanuska Telephone Association), Alaska                             | [Company website](https://mtasolutions.com/)                                                                      |
| MTC (Mobile Telecommunications Limited)                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Mtc_Namibia_Logo.svg)                                 |
| MTN Group                                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:MTN_2022_logo.svg)                                    |
| MTS (Mobile TeleSystems)                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo_МТС_%282023%29.svg)                              |
| mts (Telekom Srbija)                                                      | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Telekom_Srbija_logo.svg)                              |
| MásMóvil                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:MasMovil_2024_Logo.svg)                               |
| MásMóvil (Grupo MásMóvil)                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:MasMovil_2024_Logo.svg)                               |
| Nar Mobile (Azerfon LLC)                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nar-new-logo.jpg)                                     |
| Natcom (National Telecom S.A.)                                            | [Company website](https://natcom.com.ht/)                                                                         |
| Ncell (Ncell Axiata Limited)                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ncell_logo.svg)                                       |
| Nemont                                                                    | [Company website](https://nemont.com/)                                                                            |
| Nex-Tech Wireless                                                         | [Company website](https://nex-tech.com/)                                                                          |
| Norlys                                                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Norlys_2020_Logo.svg)                                 |
| NOS (NOS SGPS)                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:NOS_Portugal_logo.svg)                                |
| Nova (Iceland)                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nova_2021_logo.svg)                                   |
| O2 (Telefónica Germany / Virgin Media O2 UK)                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:O2_Logo_2024.svg)                                     |
| Odido                                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Odido_2023_Logo.png)                                  |
| Oi S.A. (Oi)                                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logotipo_da_Oi_%282022%29.svg)                        |
| Omantel (Oman Telecommunications Company)                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Omantel.svg)                                          |
| One Albania (4iG)                                                         | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:One_%284iG%29_logo.svg)                               |
| One Hungary                                                               | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:One_Hungary_2025.png)                                 |
| One Montenegro                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:One_%284iG%29_logo.svg)                               |
| One NZ                                                                    | [Wikipedia](https://en.wikipedia.org/wiki/File:OneNZ_2023.svg)                                                    |
| Ooredoo                                                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ooredoo_logo.svg)                                     |
| Optimum Mobile (Optimum Communications)                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Optimum_logo.png)                                     |
| Optus (Singtel Optus Pty Limited)                                         | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Optus_logo.svg)                                       |
| Orange (Orange S.A.)                                                      | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Orange_logo.svg)                                      |
| Panhandle Telephone Cooperative, Inc. (PTCI)                              | [Company website](https://ptci.net/)                                                                              |
| Paradise Mobile                                                           | Company website                                                                                                   |
| PC Mobile                                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:PC_Mobile_logo.svg)                                   |
| Pelephone                                                                 | [Wikipedia](https://en.wikipedia.org/wiki/File:Pelephone_logo.svg)                                                |
| Pepephone                                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pepephonelogo.svg)                                    |
| Personal (Telecom Argentina)                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Personal_logo_2021.svg)                               |
| Play (P4 sp. z o.o.)                                                      | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Play_logo.svg)                                        |
| Plus (Polkomtel)                                                          | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Plus_Logo.svg)                                        |
| POST Luxembourg                                                           | [Company website](https://post.lu/)                                                                               |
| PrimeTel                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Primetel-logo.png)                                    |
| Proximus                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Proximus_logo1.png)                                   |
| Public Mobile                                                             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Public-mobile-logo.png)                               |
| PureTalk                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:PureTalk-logo-2019.png)                               |
| rain (Pty) Ltd, South Africa                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Rain_Logo.svg)                                        |
| Rakuten Mobile                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Rakuten_Mobile_logo.svg)                              |
| RedteaGO / Redtea Mobile (eSIM Access Limited)                            | [Company website](https://redteago.com/)                                                                          |
| Reliance Communications                                                   | [Wikipedia](https://en.wikipedia.org/wiki/File:Reliance_Communications_Logo.svg)                                  |
| Reliance Jio                                                              | [Wikipedia](https://en.wikipedia.org/wiki/File:Reliance_Jio_Logo.svg)                                             |
| Roamless eSIM                                                             | [Company website](https://roamless.com/)                                                                          |
| Rogers Wireless (Rogers Communications)                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Rogers_Communications_%282015%29.svg)                 |
| Roshan (Afghanistan)                                                      | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Roshan_mobile.svg)                                    |
| SaskTel (Saskatchewan Telecommunications Holding Corporation)             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:SaskTel_logo.svg)                                     |
| SberMobile (СберМобайл)                                                   | [Company website](https://sbermobile.ru/)                                                                         |
| Setar (SETAR NV)                                                          | [Company website](https://setar.aw/)                                                                              |
| SFR (Altice France)                                                       | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:SFR-2022-logo.svg)                                    |
| Shaw Communications / Freedom Mobile (Canada)                             | [Wikipedia](https://en.wikipedia.org/wiki/File:Shaw_logo.svg)                                                     |
| Silknet                                                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Silknet_Logo_2018.png)                                |
| Silver Star Communications                                                | [Company website](https://silverstar.com/)                                                                        |
| Simly eSIM                                                                | Company website                                                                                                   |
| Singtel (Singapore Telecommunications Limited)                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Singtel_logo.svg)                                     |
| SK Telecom                                                                | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:SK_Telecom_Logo.svg)                                  |
| Sky Mobile                                                                | [Wikipedia](https://en.wikipedia.org/wiki/File:Sky_logo_2025.svg)                                                 |
| SLTMobitel (Mobitel)                                                      | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:SLTMobitel_Logo.svg)                                  |
| Smart Axiata                                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Smart_Axiata.svg)                                     |
| Smartfren (PT Smartfren Telecom Tbk)                                      | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Smartfren_logo.svg)                                   |
| SmarTone (SmarTone Telecommunications Holdings)                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:SmarTone_logo.svg)                                    |
| SoftBank Mobile (SoftBank Corp.)                                          | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Softbank_mobile_logo.svg)                             |
| Spectrum Mobile                                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Spectrum_Mobile_Logo.svg)                             |
| SRT Communications (Souris River Telecommunications), Minot, North Dakota | [Company website](https://srt.com/)                                                                               |
| stc (Saudi Telecom Company)                                               | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:STC-01.svg)                                           |
| Strata Networks                                                           | [Company website](https://stratanetworks.com/)                                                                    |
| Sunrise (Sunrise LLC)                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sunrise_2022.svg)                                     |
| Sure (Sure Group / Sure by Beyon)                                         | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sure_%28Guernsey%29_Limited_Rebrand_Logo.png)         |
| Swisscom                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Swisscom_Logo_2025.svg)                               |
| Síminn hf.                                                                | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sjónvarp_Símans.svg)                                  |
| T-Mobile US                                                               | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:T-Mobile_US_Logo_2022_RGB_Magenta_on_Transparent.svg) |
| Talk Mobile (Talkmobile)                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Talkmobile_logo.svg)                                  |
| Tango (Luxembourg)                                                        | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tango_%28telecom%29_logo.svg)                         |
| TashiCell (Tashi InfoComm Private Limited), Bhutan                        | [Company website](https://tashicell.com/)                                                                         |
| Tbaytel                                                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tbaytel_logo.svg)                                     |
| TCC (Tonga Communications Corporation)                                    | [Company website](https://tcc.to/)                                                                                |
| Team Telecom Armenia (Beeline Armenia)                                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Telecom_Armenia.svg)                                  |
| Tele2                                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tele2_Obegransad_Svart_Logotyp.png)                   |
| Telecom Namibia                                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Telecom_Namibia_Logo.svg)                             |
| Telemach                                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Telemach_2022.webp)                                   |
| Telenet                                                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo_of_Telenet_%282002%29.svg)                       |
| Telenor                                                                   | [Wikipedia](https://en.wikipedia.org/wiki/File:Telenor.svg)                                                       |
| Telia                                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Telia_Company_logo_2022.svg)                          |
| Telkomsel                                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Telkomsel_2021_icon.svg)                              |
| TELUS                                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Telus-Logo.svg)                                       |
| Thumb Cellular                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Thumb_Cellular_Logo.png)                              |
| Tigo (Millicom)                                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo_Tigo.svg)                                        |
| TIM (Telecom Italia / TIM Brasil)                                         | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Gruppo_TIM_logo_%282019-present%29.svg)               |
| Timor Telecom                                                             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Novologo_timor_telecom_sapo.jpg)                      |
| Tmcel (Moçambique Telecom)                                                | [Company website](https://tmcel.mz/)                                                                              |
| Transatel                                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:NTT-TSL_blue_%282%29.png)                             |
| True Corporation (TrueMove H)                                             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:True_Corporation_%28Thailand%29.svg)                  |
| Tuenti (Telefónica)                                                       | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tuenti.svg)                                           |
| Tusass A/S                                                                | [Company website](https://tusass.gl/)                                                                             |
| Türk Telekom                                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Türk_Telekom_logo.svg)                                |
| Umniah (Umniah by Beyon), Jordan                                          | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Umniah's_New_2025_Logo.png)                           |
| Union Wireless                                                            | [Company website](https://unionwireless.com/)                                                                     |
| United Wireless                                                           | [Company website](https://getunited.com/)                                                                         |
| Unitel (Angola)                                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Unitel_Logo_2005.svg)                                 |
| Unitel (Mongolia)                                                         | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Unitel_Logo.png)                                      |
| Unitel (Star Telecom Co.), Laos                                           | [Company website](https://unitel.com.la/)                                                                         |
| Uztelecom                                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Uztelecom-primary-logotype-RGB.svg)                   |
| Verizon                                                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Verizon_2024.svg)                                     |
| Vi (Vodafone Idea Limited)                                                | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Vodafone_Idea_logo_%282026%29.svg)                    |
| Viaero Wireless                                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Viaero_Wireless_logo.png)                             |
| Viettel                                                                   | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Viettel_Group_en_logo.svg)                            |
| VinaPhone                                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo_Vinaphone.svg)                                   |
| Vini (OPT French Polynesia)                                               | [Company website](https://vini.pf/)                                                                               |
| Virgin Mobile (Virgin Media O2)                                           | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Virgin_Mobile.svg)                                    |
| Virgin Plus (Bell Canada)                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Virgin_Plus_logo.svg)                                 |
| Visible by Verizon                                                        | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Visible_by_verizon_logo.svg)                          |
| Vivacom                                                                   | [Wikipedia](https://en.wikipedia.org/wiki/File:Vivacom_logo_2021.svg)                                             |
| Vivo (Telefônica Brasil)                                                  | [Wikipedia](https://en.wikipedia.org/wiki/File:Vivo_%28Brazil%29_logo.svg)                                        |
| Vodafone Cook Islands (Bluesky Cook Islands)                              | [Wikipedia](https://en.wikipedia.org/wiki/File:Vodafone_2017_logo.svg)                                            |
| Vodafone Group                                                            | [Wikipedia](https://en.wikipedia.org/wiki/File:Vodafone_2017_logo.svg)                                            |
| VTR (Chile)                                                               | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:VTRlogo.png)                                          |
| WE (Telecom Egypt)                                                        | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:We_logo.svg)                                          |
| WINDTRE (Wind Tre S.p.A.)                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Wind_Tre_logo_2020.svg)                               |
| WOM (WOM S.A. Chile / WOM Colombia)                                       | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:WOM_Chile.svg)                                        |
| Xfinity Mobile                                                            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Xfinity_2025.svg)                                     |
| XL Axiata (XLSMART), Indonesia                                            | [Wikipedia](https://en.wikipedia.org/wiki/File:XL_logo_2016.svg)                                                  |
| Y!mobile (SoftBank Corp.)                                                 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Y!mobile.svg)                                         |
| Yas (Axian Telecom)                                                       | [Company website](https://yas.co.tz/)                                                                             |
| Yes (YTL Communications)                                                  | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Yes_Logomark_pink.png)                                |
| Yettel (e&amp; PPF Telecom Group)                                         | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Yettellimelogo.svg)                                   |
| Yoigo (Xfera Moviles)                                                     | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Yoigo_morado.svg)                                     |
| Yota                                                                      | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Логотип_Yota.svg)                                     |
| Zeop (Zeop Mobile)                                                        | [Company website](https://zeop.re/)                                                                               |
| Zong (China Mobile Pakistan)                                              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Zong.png)                                             |
| Ålcom (Ålands Telekommunikation Ab)                                       | [Company website](https://alcom.ax/)                                                                              |

### Original logos, unmodified

| Carrier                                            | Source                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1GLOBAL (Truphone)                                 | [Company website](https://1global.com/)                                                  |
| Airalo (eSIM marketplace)                          | [Company website](https://airalo.com/)                                                   |
| aloSIM (AffinityClick)                             | [Company website](https://alosim.com/)                                                   |
| Elisa Oyj                                          | [Company website](https://elisa.com/)                                                    |
| GTA Teleguam                                       | [Wikipedia](https://en.wikipedia.org/wiki/File:GTA_Teleguam_logo.svg)                    |
| HKBN (Hong Kong Broadband Network)                 | [Wikipedia](https://en.wikipedia.org/wiki/File:HKBN_official_logo.svg)                   |
| Jawwal (Palestine Cellular Communications Company) | [Wikipedia](https://en.wikipedia.org/wiki/File:Jawwal_Logo.png)                          |
| Jazz (Pakistan Mobile Communications Limited)      | [Wikipedia](https://en.wikipedia.org/wiki/File:Jazz_logo.svg)                            |
| JT (Jersey Telecom)                                | [Wikipedia](https://en.wikipedia.org/wiki/File:Jt_global_logo.svg)                       |
| Korek Telecom                                      | [Wikipedia](https://en.wikipedia.org/wiki/File:Korek_Telecom_logo.svg)                   |
| La Poste Mobile                                    | [Wikipedia](https://en.wikipedia.org/wiki/File:LaPosteMobile-2025.svg)                   |
| Liberty Puerto Rico (Liberty Latin America)        | [Wikipedia](https://en.wikipedia.org/wiki/File:Liberty_Puerto_Rico_Logo.png)             |
| LMT (Latvijas Mobilais Telefons)                   | [Wikipedia](https://en.wikipedia.org/wiki/File:Latvijas_Mobilais_Telefons_logo_2013.png) |
| Nepal Telecom                                      | [Wikipedia](https://en.wikipedia.org/wiki/File:Nepal_Telecom_logo.JPG)                   |
| Porto Seguro S.A. (Porto Conecta)                  | [Wikipedia](https://en.wikipedia.org/wiki/File:Porto_seguro_seguros_logo.jpg)            |
| Progresif (Progresif Sdn Bhd)                      | [Wikipedia](https://en.wikipedia.org/wiki/File:Progresif_Cellular_logo.png)              |
| Robi Axiata                                        | [Wikipedia](https://en.wikipedia.org/wiki/File:Logo_of_Robi_Axiata.svg)                  |
| Safaricom PLC                                      | [Wikipedia](https://en.wikipedia.org/wiki/File:Safaricom_logo.svg)                       |
| Smart Communications (PLDT)                        | [Wikipedia](https://en.wikipedia.org/wiki/File:Smart_Communications_2016_logo.svg)       |
| Spark New Zealand                                  | [Wikipedia](https://en.wikipedia.org/wiki/File:Spark_New_Zealand_logo.svg)               |
| StarHub                                            | [Wikipedia](https://en.wikipedia.org/wiki/File:StarHub_%282021%29.svg)                   |
| SUN Mobile (Hong Kong)                             | [Wikipedia](https://en.wikipedia.org/wiki/File:SUN_Mobile_logo.png)                      |
| T-2 (T-2 d.o.o.)                                   | [Wikipedia](https://en.wikipedia.org/wiki/File:T-2_%28ISP%29.png)                        |
| TDC / Nuuday (TDC Group)                           | [Wikipedia](https://en.wikipedia.org/wiki/File:TDC.svg)                                  |
| Telekom Slovenije                                  | [Wikipedia](https://en.wikipedia.org/wiki/File:Telekom_Slovenije_logo.svg)               |
| Telesur (Telecommunicatiebedrijf Suriname)         | [Wikipedia](https://en.wikipedia.org/wiki/File:Telesur_%28Suriname%29_logo.png)          |
| Telkom (South Africa)                              | [Wikipedia](https://en.wikipedia.org/wiki/File:Telkom_Logo_2025.png)                     |
| Telstra                                            | [Wikipedia](https://en.wikipedia.org/wiki/File:Telstra_logo.svg)                         |
| Tesco Mobile                                       | [Wikipedia](https://en.wikipedia.org/wiki/File:Tesco_Mobile.svg)                         |
| Three (Three UK / Hutchison)                       | [Wikipedia](https://en.wikipedia.org/wiki/File:Logo_of_Three_UK.svg)                     |
| Tracfone Wireless (Verizon)                        | [Wikipedia](https://en.wikipedia.org/wiki/File:Verizon_Value_Logo.png)                   |
| Tunisie Telecom                                    | [Wikipedia](https://en.wikipedia.org/wiki/File:Tunisie_Telecom_Logo.png)                 |
| Turkcell                                           | [Wikipedia](https://en.wikipedia.org/wiki/File:Turkcell_logo.svg)                        |
| U Mobile                                           | [Wikipedia](https://en.wikipedia.org/wiki/File:U_Mobile_logo.svg)                        |
| Vidéotron                                          | [Wikipedia](https://en.wikipedia.org/wiki/File:Vidéotron_Logo.svg)                       |
| Xplore Mobile (Xplore Inc.)                        | [Wikipedia](https://en.wikipedia.org/wiki/File:Xplore_Inc._Logo.png)                     |
| Zain Group                                         | [Wikipedia](https://en.wikipedia.org/wiki/File:Zain_Group_logo.svg)                      |

### Template tile

No logo is used for 1&amp;1 (1&amp;1 AG), A1 Telekom Austria Group, AIS (Advanced Info Service), Thailand, AT&amp;T, au by KDDI, BASE (Telenet), Beeline (VimpelCom / VEON), Bell Canada, Bharti Airtel, BICS, Boost Mobile, Bouygues Telecom, BT Group, CelcomDigi, Cellcom Israel Ltd., Cellfie, Chatr Mobile, Cincinnati Bell Inc. (altafiber), Claro (América Móvil), Comviq, Consumer Cellular, Copper Valley Telecom, Coriolis Télécom, Cox Mobile (Cox Communications), Cricket Wireless, csl (CSL Mobile Limited), Digi (Speednet Communications), Belize, Digicel, DNA Oyj, DST Communications (DSTCom), Bhutan, dtac (Total Access Communication), Thailand, EE, eir (eircom Limited), eNetworks, Entel, Etisalat / e&amp; (Emirates Telecommunications Group), Far EasTone Telecommunications (FET), Fastweb, Fido, FirstNet (AT&amp;T / First Responder Network Authority), Fizz (Fizz Mobile), Flow (Cable &amp; Wireless / Liberty Latin America), Giga, Helia (Finland), ITE, Izi mobil, Lum, M-Tel / Mtel (Bulgaria), MTX, NRJ Mobile, NTT Docomo, Ora, PNCC (Papua New Guinea), povo (KDDI), Red Pocket Mobile, Salam (Oman), Seatel (South East Asia Telecom (Cambodia) Co., Ltd., 'yes seatel'), Simple Mobile, Skinny Mobile, Smart (Belize Telemedia Limited), SORACOM, Spark / Yoodo (CelcomDigi sub-brand), Taiwan Mobile, Tcell (Indigo Tajikistan), Ting Mobile, Tunz, Unefon, UQ mobile, Very Mobile (Vodafone / Very Group), Wim, Wingo (Switzerland), ZET Mobile (Bulgaria).

## Contact

Have an issue with attribution, your trademark or anything else here? Please contact me at `<alec> @ simplyalec.com`.
