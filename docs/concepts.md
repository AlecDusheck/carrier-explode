# Concepts: how each platform answers

The registry is `src/lib/schema/concepts.ts`; the readers are `src/lib/schema/ios/readers.ts` and `src/lib/schema/android/readers.ts`.

## Reading rules

- Apple readings come from carrier.plist with the newest phone's `overrides_<boards>.plist` merged on top, as CommCenter merges them. Modern bundles keep most of what matters in the override files: T-Mobile's carrier.plist has no 5G key at all. Other phones and `MVNOOverrides` configurations are Profile variants.
- Android readings come from one CarrierSettings file. A file lists only what the carrier changes. For the keys whose AOSP default decides a feature state (`AOSP_DEFAULTS`), the reader uses the default and names it `default:<key>`. Every other key is `unset` when absent.
- Apple never gets a guessed default: CommCenter's defaults are not public.
- Units are normalised: times in the unit the registry names, whatever the native key uses; unordered lists sorted; codec, radio and icon names spelled one way.
- Fidelity: `exact` means the same meaning; `derived` means computed from several keys; `approx` means the closest equivalent, with the difference noted below.
- Feature states on Apple come from `src/lib/features.ts`, so the carrier and feature pages agree.

## Mapping

| Concept | Group | Apple | Android |
|---|---|---|---|
| `5g` | features | features.ts | `carrier_nr_availabilities_int_array` non-empty (derived) |
| `5g-standalone` | features | features.ts | `carrier_nr_availabilities_int_array` has SA (derived) |
| `voice-over-5g` | features | features.ts | `vonr_enabled_bool`, `vonr_on_by_default_bool` |
| `volte` | features | features.ts | `carrier_volte_available_bool`, `enhanced_4g_lte_on_by_default_bool` |
| `hd-voice-plus` | features | features.ts | EVS in `imsvoice.audio_codec_capability_payload_types_bundle` |
| `wifi-calling` | features | features.ts | `carrier_wfc_ims_available_bool`, `carrier_default_wfc_ims_enabled_bool` |
| `calls-on-other-devices` | features | features.ts | — |
| `rcs` | features | features.ts | — |
| `rcs-business-messaging` | features | features.ts | — |
| `satellite` | features | features.ts | `satellite_attach_supported_bool`; else `carrier_supported_satellite_services_per_provider_bundle` (approx) |
| `visual-voicemail` | features | features.ts | `vvm_type_string`; else `carrier_vvm_package_name_string` (approx) |
| `esim-transfer` | features | features.ts | — |
| `esim-from-android` | features | features.ts | — |
| `apple-watch-number-sharing` | features | features.ts | — |
| `branded-calling` | features | features.ts | — |
| `spam-call-warnings` | features | features.ts | — |
| `video-calling` | features | — | `carrier_vt_available_bool` |
| `rtt` | voice | `IMSConfig.Voice.RTTSupported` | `rtt_supported_bool` |
| `volte-switch` | voice | `ShowVolteSwitch` | `carrier_volte_available_bool` ∧ ¬`hide_enhanced_4g_lte_bool` ∧ `editable_enhanced_4g_lte_bool` (derived) |
| `vonr-switch` | voice | `ShowVoNRSwitch` | `vonr_enabled_bool` ∧ `vonr_setting_visibility_bool` (derived) |
| `audio-codecs` | voice | `IMSConfig.Media.AudioCodecs[].EncodingName` | codecs with payload types in `imsvoice.audio_codec_capability_payload_types_bundle` |
| `tty` | voice | `ShowTTY` (approx) | `tty_supported_bool` (approx) |
| `tty-over-ims` | voice | `IMSConfig.Voice.ttyIMSSupported` | `carrier_volte_tty_supported_bool` |
| `sip-ipsec` | voice | `IMSConfig.Signaling.UseIPSec` | `ims.sip_over_ipsec_enabled_bool` |
| `sip-precondition` | voice | `IMSConfig.Signaling.Preconditions` | `imsvoice.voice_qos_precondition_supported_bool` |
| `prack-18x` | voice | `IMSConfig.Signaling.AlwaysPrack18x` (approx) | `imsvoice.prack_supported_for_18x_bool` (approx) |
| `conference-uri` | voice | `IMSConfig.ConferenceCalling.conferenceServer` | `imsvoice.conference_factory_uri_string` |
| `conference-size` | voice | `MaxMultiPartyCalls` (approx) | `ims_conference_size_limit_int` (approx) |
| `ringing-timer` | voice | `IMSConfig.Signaling.RingingTimerSeconds` | `imsvoice.ringing_timer_millis_int` |
| `ringback-timer` | voice | `IMSConfig.Signaling.RingbackTimerSeconds` | `imsvoice.ringback_timer_millis_int` |
| `session-expires` | voice | `IMSConfig.Signaling.SessionExpiresSeconds` | `imsvoice.session_expires_timer_sec_int` |
| `ims-registration-expiry` | voice | `IMSConfig.Signaling.RegistrationExpirationSeconds` | `ims.registration_expiry_timer_sec_int` |
| `ims-retry-base` | voice | `IMSConfig.Signaling.RegistrationRetryBaseTimeSeconds` | `ims.registration_retry_base_timer_millis_int` |
| `ims-retry-max` | voice | `IMSConfig.Signaling.RegistrationRetryMaxTimeSeconds` | `ims.registration_retry_max_timer_millis_int` |
| `sip-timer-t1` | voice | `IMSConfig.Signaling.SipTimers.T1` | `ims.sip_timer_t1_millis_int` |
| `sip-timer-t2` | voice | `IMSConfig.Signaling.SipTimers.T2` | `ims.sip_timer_t2_millis_int` |
| `sip-timer-t4` | voice | `IMSConfig.Signaling.SipTimers.T4` | `ims.sip_timer_t4_millis_int` |
| `sip-timer-b` | voice | `IMSConfig.Signaling.SipTimers.B` | `ims.sip_timer_b_millis_int` |
| `sip-timer-d` | voice | `IMSConfig.Signaling.SipTimers.D` | `ims.sip_timer_d_millis_int` |
| `sip-timer-f` | voice | `IMSConfig.Signaling.SipTimers.F` | `ims.sip_timer_f_millis_int` |
| `sip-timer-h` | voice | `IMSConfig.Signaling.SipTimers.H` | `ims.sip_timer_h_millis_int` |
| `sip-timer-j` | voice | `IMSConfig.Signaling.SipTimers.J` | `ims.sip_timer_j_millis_int` |
| `sip-udp-limit` | voice | `IMSConfig.Signaling.MaxUdpMessageSize` (approx) | `ims.ipv4_sip_mtu_size_cellular_int` (approx) |
| `rtp-inactivity` | voice | `IMSConfig.Media.InactivityTimerRTPSeconds` | `imsvoice.audio_rtp_inactivity_timer_millis_int` |
| `rtcp-inactivity` | voice | `IMSConfig.Media.InactivityTimerRTCPSeconds` | `imsvoice.audio_rtcp_inactivity_timer_millis_int` |
| `ims-user-agent` | voice | `IMSConfig.Signaling.UserAgentHeaderValue` (approx) | `ims.ims_user_agent_string` (approx) |
| `nr-modes` | nr | `nrModes` | `carrier_nr_availabilities_int_array` |
| `5g-switch` | nr | `Show5GSwitch` | — |
| `5g-icon-advanced` | nr | `DataIndicatorOverrideForNRMmwave` | `connected_mmwave` icon in `5g_icon_configuration_string`, when it differs from `connected` |
| `lte-icon` | nr | `DataIndicatorOverrideForLTE` | `show_4g_for_lte_data_icon_bool` |
| `wfc-mode` | wifi-calling | `TechSettings.iRatPolicies.PreferredTechnology` | `carrier_default_wfc_ims_mode_int` |
| `wfc-roaming-mode` | wifi-calling | `TechSettings.iRatPolicies.PreferredTechnologyRoaming` | `carrier_default_wfc_ims_roaming_mode_int` |
| `wfc-roaming` | wifi-calling | `TechSettings.WifiCallingAllowedInRoaming` (approx) | `carrier_default_wfc_ims_roaming_enabled_bool` (approx) |
| `epdg-address` | wifi-calling | `TechSettings.IKE.RemoteAddress` | `iwlan.epdg_static_address_string` |
| `ike-dh-groups` | wifi-calling | `dhGroups` | `iwlan.diffie_hellman_groups_int_array` |
| `wifi-calling-name` | wifi-calling | `OverrideOperatorWiFiName` | — |
| `sms-over-ims` | messaging | `smsOverIms` | `imssms.sms_over_ims_supported_bool` |
| `sms-over-ims-networks` | messaging | `smsDomains` | `imssms.sms_over_ims_supported_rats_int_array` |
| `mms-max-size` | messaging | `MMS.MaxMessageSize` | `maxMessageSize` |
| `mms-max-recipients` | messaging | `MMS.MaxRecipients` | `recipientLimit` |
| `mms-max-image` | messaging | `MMS.MaxImageDimension` | `mmsImage` |
| `mms-max-subject` | messaging | `MMS.MaxSubjectLenBytes` (approx) | `maxSubjectLength` (approx) |
| `mms-group` | messaging | `MMS.GroupModeEnabled` (approx) | `enableGroupMms` (approx) |
| `mms-roaming-download` | messaging | `MMS.OnWhileRoaming` (approx) | `mmsRoamingAutoRetrieveByDefault` (approx) |
| `mmsc` | messaging | `MMS.MMSC` | MMS APN `mmsc` |
| `mms-proxy` | messaging | `MMS.Proxy` | MMS APN `mmsc_proxy`:`mmsc_proxy_port` |
| `mms-uaprof` | messaging | `MMS.UAProf` | `uaProfUrl` |
| `mms-user-agent` | messaging | `MMS.UAString` | `userAgent` |
| `ussd-over-ims` | supplementary | `ussd` | `carrier_ussd_method_int` (approx) |
| `ss-over-ut` | supplementary | `IMSConfig.XCAP.supported` | `carrier_supports_ss_over_ut_bool` |
| `xcap-server` | supplementary | `IMSConfig.XCAP.NafHost` | `imsss.ut_as_server_fqdn_string` |
| `xcap-port` | supplementary | `IMSConfig.XCAP.NafPort` | `imsss.ut_as_server_port_int` |
| `bsf-server` | supplementary | `IMSConfig.XCAP.BsfHost` | `bsf.bsf_server_fqdn_string` |
| `bsf-port` | supplementary | `IMSConfig.XCAP.BsfPort` | `bsf.bsf_server_port_int` |
| `emergency-over-ims` | emergency | `IMSConfig.Voice.E911OverIMSSupported` | `imsemergency.emergency_over_ims_supported_rats_int_array` (derived) |
| `emergency-numbers` | emergency | `EmergencyCalling.EmergencyNumbers[]`, `EmergencyNumbers.<mcc>[]` | — (Android keeps them in the emergency number database) |
| `text-to-emergency` | emergency | `SMSSettings.SupportsTextToEmergency` (approx) | `support_emergency_sms_over_ims_bool` (approx) |
| `cell-broadcast-channels` | emergency | `cbsChannels` | `carrier_additional_cbs_channels_strings` (approx) |
| `apn-internet` | data | APNs (default) | APNs (default) |
| `apn-mms` | data | APNs (mms) | APNs (mms) |
| `apn-ims` | data | APNs (ims) | APNs (ims) |
| `apn-emergency` | data | APNs (emergency) | APNs (emergency) |
| `apn-xcap` | data | APNs (xcap) | APNs (xcap) |
| `apn-attach` | data | APNs (ia) | APNs (ia) |
| `internet-ip` | data | APNs (default) | APNs (default) |
| `internet-ip-roaming` | data | APNs (default) | APNs (default) |
| `data-mtu` | data | `MTU[]` entry covering LTE/NR (approx) | default APN `mtu` (approx) |
| `tethering-apn` | tethering | APNs (dun) | APNs (dun) |
| `home-networks` | roaming | `SupportedPLMNs` (approx: includes the carrier's own) | `non_roaming_operator_string_array` ∪ `gsm_nonroaming_networks_string_array` (approx) |
| `data-roaming-default` | roaming | — | `carrier_default_data_roaming_enabled_bool` |
| `carrier-name` | display | `CarrierName` | `carrier_name_string` (approx) |
| `country-iso` | display | `countryIso` | `sim_country_iso_override_string` |
| `voicemail-number` | voicemail | `VoicemailPilotNumber` | `default_vm_number_string` |
| `voicemail-roaming-number` | voicemail | `RoamingVoicemailPilotNumber` | `default_vm_number_roaming_string` |
| `satellite-name` | satellite | `SatelliteSystemName` | `satellite_display_name_string` |
| `entitlement-server` | entitlement | `CarrierEntitlements.ServerAddress` | `imsserviceentitlement.entitlement_server_url_string` |
| `lte-rsrp-thresholds` | signal | — | `lte_rsrp_thresholds_int_array` |
| `nr-rsrp-thresholds` | signal | — | `5g_nr_ssrsrp_thresholds_int_array` |

## Approximations worth knowing

- `tty`: Apple's `ShowTTY` shows the TTY switch; Android's `tty_supported_bool` says TTY works.
- `prack-18x`: Apple's key says *always* PRACK; Android's says PRACK is *supported*.
- `conference-size`: Apple counts parties on a call; Android counts conference participants.
- `sip-udp-limit`: Apple's maximum UDP message size against Android's SIP MTU over cellular. Both are the size above which SIP moves to TCP.
- `wfc-roaming`: Apple's says Wi-Fi Calling is *allowed* abroad; Android's says it *starts on* abroad.
- `home-networks`: Apple's `SupportedPLMNs` includes the carrier's own network codes; Android lists only the extra ones.
- `cell-broadcast-channels`: Android lists only the channels it adds to the platform defaults.
- `carrier-name`: Android's `carrier_name_string` applies only when the SIM provides no name, unless `carrier_name_override_bool` is set.
- `5g-icon-advanced`: Android can draw "5G+" only, so Verizon's "5G UW" and T-Mobile's "5G UC" on iOS compare as different.

## SIM linking

- Sources link through an exact shared `matcherKey` after normalisation: GID hex upper-cased, FF padding dropped, an all-FF GID treated as no GID.
- A pair links when each is the other's best match by shared keys. It also links when one side shares at least half of its keys with its best match, as `att5gsa_us` does with `ATT_NR_US`.
- An MVNO that lists one of its host's network codes among many of its own stays apart.
- Apple bundles with one name (iPhone, iPad, Watch) are one carrier.
- `src/lib/schema/links.ts` holds the manual links, splits and names, each with its reason.

## Timelines and v1 URLs

- Apple versions name content. Android versions are counters per device, so Android timelines are per device line (`Timeline` in types.ts).
- v1 slugs are derived from the v2 copy they named:
  - an image copy answers to `ios-<version>-<build>` for every release that carried it;
  - the bare `ios-<version>` goes to the newest entry that has that iOS version;
  - OTA files that share a v1 slug (`ota-<build>[-<productType>]`) are numbered in v1's order: OS key, then build, newest first;
  - `iPad` maps to the ipados source, a model to that model's line, and `iPhone` (CarrierBundles.iPhone) to the main line.
- `test/schema-timeline.test.ts` ports v1's algorithm and checks that every slug it produces resolves.
