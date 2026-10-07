// A synthetic carrier pack in Galaxy firmware's layout, mapped to a Profile.

import { describe, expect, it } from "vitest";

import {
	decodeOmcInfo,
	imsOperator,
	openOmc,
	packOmc,
	PACK_FILES,
	readIms,
} from "@carrier-explode/decode-samsung";
import { phoneStates, samsungProfile } from "../src/index.ts";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

const files = new Map([
	[
		PACK_FILES.omcInfo,
		text(`<omcInfo><version>SAOMC_SM-S931B_OXM_XYZ_16_0007</version><model><name>SM-S931B</name></model><carrierList>
    <carrier><mcc>208</mcc><mnc>10</mnc></carrier>
    <carrier><mcc>208</mcc><mnc>10</mnc><spn>Mvno.</spn><codeType>HEX</codeType><gid>434F5249</gid><iccid>893327</iccid></carrier>
    <carrier><mcc>206</mcc><mnc>01</mnc><codeType>DEC</codeType><gid>117</gid></carrier>
    <carrier><mcc>530</mcc><mnc>05</mnc><spn>Skinny</spn><subsetCode>204</subsetCode></carrier></carrierList></omcInfo>`),
	],
	[
		PACK_FILES.customer,
		text(`<CustomerData><GeneralInfo><CountryISO>FR</CountryISO></GeneralInfo><Settings><Connections>
    <ProfileHandle><NetworkName>Net</NetworkName><ProfBrowser>Web</ProfBrowser><ProfIntSharing>Web</ProfIntSharing><ProfMMS>MMS</ProfMMS></ProfileHandle>
    <Profile><NetworkName>Net</NetworkName><ProfileName>Web</ProfileName><Auth>secure</Auth><IpVersion>ipv4</IpVersion><PSparam><APN>web.example</APN><Password>p</Password></PSparam></Profile>
    <Profile><NetworkName>Net</NetworkName><ProfileName>MMS</ProfileName><URL>http://mms.example</URL>
      <Proxy><EnableFlag>on</EnableFlag><ServAddr>10.0.0.1</ServAddr><Port>8080</Port></Proxy><PSparam><APN>mms.example</APN></PSparam></Profile>
    </Connections><Messages><MMS><GroupMessaging>on</GroupMessaging><MmsReceiving><Roaming>manual</Roaming></MmsReceiving>
      <MmsSending><MessageSize>1.2m</MessageSize><MaxRecipientMMS>20</MaxRecipientMMS><ImageResizeResolution>uxga</ImageResizeResolution></MmsSending>
      <MMSView><MessageUserAgent>sammmsv1</MessageUserAgent></MMSView></MMS></Messages>
    <Main><Network><SOSNumber>911</SOSNumber><SOSNumber>112</SOSNumber></Network></Main></Settings></CustomerData>`),
	],
	[
		PACK_FILES.carrierFeature,
		text(
			JSON.stringify({
				version: "11",
				mapped_cid_version: "160027",
				customer: [
					{
						carrier_group: "XYZ",
						feature: {
							CarrierFeature_RIL_SupportVolte: "TRUE",
							CarrierFeature_VoiceCall_ConfigOpStyleMobileNetworkSettingMenu: "-voltecall,+vonrcall",
						},
					},
				],
				specific: [],
			}),
		),
	],
]);

/** IMS maps naming the pack's home network: VoLTE, Wi-Fi Calling and SMS over IMS on, video calling off; an MVNO rule naming another operator. */
const ims = readIms(
	new Map([
		[
			"mnomap.json",
			text(`{ "mnomap": [ // the home network, and an MVNO by GID1
    { "mccmnc": "20810", "subset": "", "gid1": "", "gid2": "", "spname": "", "mnoname": "NET_FR@BLOCKGC" },
    { "mccmnc": "20810", "subset": "", "gid1": "434F", "gid2": "", "spname": "", "mnoname": "MVNO_FR" } ] }`),
		],
		[
			"imsswitch.json",
			text(`{ "defaultswitch": { "enableIms": false }, "imsswitch": [
    { "mnoname": "NET_FR", "enableIms": true, "enableServiceVolte": true, "enableServiceVowifi": true, "enableServiceVilte": false, "enableServiceSmsip": true } ] }`),
		],
		[
			"globalsettings.json",
			text(`{ "defaultsetting": { "ss_domain_setting": "CS", "emergency_domain_setting": "CS", "bsf_port": 80 },
    "globalsetting": [ { "mnoname": "NET_FR", "ss_domain_setting": "PS_ONLY_VOLTEREGIED", "ussd_domain_setting": "PSCS", "emergency_domain_setting": "PS" } ] }`),
		],
		[
			"imsprofile.json",
			text(`{ "profile": [ { "mnoname": "NET_FR", "support_ipsec": true, "useragent": "[PRODUCT_MODEL] Samsung IMS 6.0",
    "audio_codec": "EVS,AMRBE-WB,AMR-WB,AMRBE,AMR,DTMFWB,DTMF", "enable_evs_codec": true, "use_precondition": true,
    "conference_uri": "sip:conf@ims.example", "session_expires": 1800, "reg_expires": null,
    "timer": "1:2000,2:16000,4:17000,A:2000,B:128000,C:180000,D:128000,E:2000,F:128000,G:2000,H:128000,I:17000,J:128000,K:17000" } ] }`),
		],
	]),
);

const info = files.get(PACK_FILES.omcInfo);
if (info === undefined) throw new Error("no omc.info");
const omcInfo = decodeOmcInfo(new TextDecoder().decode(info));
const XYZ = { platform: "samsung", kind: "carrier", name: "XYZ" } as const;
const p = samsungProfile(openOmc(packOmc(files, imsOperator(omcInfo, ims))), XYZ, "sha");

describe("samsungProfile", () => {
	it("reads omc.info's rules: GID1 in hex, a decimal GID converted, the network subset as an IMSI prefix", () => {
		expect(p.identity.iso).toEqual(["fr"]);
		expect(p.identity.sims).toEqual([
			{ mccmnc: "20810" },
			{ mccmnc: "20810", gid1: "434F5249", spn: "MVNO.", iccidPrefix: "893327" },
			{ mccmnc: "20601", gid1: "75" },
			{ mccmnc: "53005", spn: "SKINNY", imsiPrefix: "53005204" },
		]);
	});

	it("types each profile by the roles its network's handle gives it", () => {
		expect(p.apns).toEqual([
			{
				apn: "web.example",
				label: "Web",
				types: ["default", "dun"],
				protocol: "ip",
				auth: "chap",
				hasPassword: true,
				path: "customer.xml:Settings.Connections.Profile[0]",
			},
			{
				apn: "mms.example",
				label: "MMS",
				types: ["mms"],
				hasPassword: false,
				mmsProxy: "10.0.0.1",
				mmsPort: "8080",
				mmsc: "http://mms.example",
				path: "customer.xml:Settings.Connections.Profile[1]",
			},
		]);
	});

	it("reads the IMS service's switches and profile for the operator most of the pack's SIMs are", () => {
		expect(p.concepts.volte).toMatchObject({ kind: "state", state: "on", fidelity: "exact" });
		expect(p.concepts["wifi-calling"]).toMatchObject({ kind: "state", state: "on" });
		expect(p.concepts["video-calling"]).toMatchObject({ kind: "state", state: "no" });
		expect(p.concepts["sms-over-ims"]).toMatchObject({ kind: "value", value: true });
		expect(p.concepts["sip-ipsec"]).toMatchObject({ kind: "value", value: true });
		expect(p.raw["mnomap.json:mnoname"]).toBe("NET_FR");
		// Under one key whatever the operator's name, so a scan of it reaches every pack.
		expect(p.raw["imsswitch.json:operator.enableServiceVolte"]).toBe(true);
		expect(p.raw["imsprofile.json:operator[0].support_ipsec"]).toBe(true);
		expect(p.raw["globalsettings.json:operator.ss_domain_setting"]).toBe("PS_ONLY_VOLTEREGIED");
		expect(Object.keys(p.raw).filter((k) => k.includes("NET_FR"))).toEqual([]);
	});

	it("reads the operator's codecs, preconditions, conference server and SIP timers from its IMS profile", () => {
		expect(p.concepts["hd-voice-plus"]).toMatchObject({ kind: "state", state: "on" });
		expect(p.concepts["audio-codecs"]).toMatchObject({ value: ["AMR", "AMR-WB", "EVS"] });
		expect(p.concepts["sip-precondition"]).toMatchObject({ value: true });
		expect(p.concepts["conference-uri"]).toMatchObject({ value: "conf@ims.example" });
		expect(p.concepts["session-expires"]).toMatchObject({ value: 1800 });
		expect(p.concepts["ims-registration-expiry"]).toMatchObject({ kind: "unset" });
		expect(p.concepts["sip-timer-t1"]).toMatchObject({ value: 2000 });
		expect(p.concepts["sip-timer-b"]).toMatchObject({ value: 128000 });
	});

	it("reads Ut, USSD and emergency domains from the operator's global settings, and no port without a server", () => {
		expect(p.concepts["ss-over-ut"]).toMatchObject({ value: true });
		expect(p.concepts["ussd-over-ims"]).toMatchObject({ value: true });
		expect(p.concepts["emergency-over-ims"]).toMatchObject({ value: true });
		expect(p.concepts["bsf-port"]).toMatchObject({ kind: "unset" });
	});

	it("reads customer.xml's MMS limits and emergency numbers", () => {
		expect(p.concepts["mms-max-size"]).toMatchObject({ value: 1258291 });
		expect(p.concepts["mms-max-recipients"]).toMatchObject({ value: 20 });
		expect(p.concepts["mms-max-image"]).toMatchObject({ value: 1600 });
		expect(p.concepts["mms-group"]).toMatchObject({ value: true });
		expect(p.concepts["mms-roaming-download"]).toMatchObject({ value: false });
		expect(p.concepts["mms-user-agent"]).toMatchObject({ value: "sammmsv1" });
		expect(p.concepts["emergency-numbers"]).toMatchObject({ value: ["112", "911"] });
	});

	it("reads the internet APN's IP versions, the hotspot APN and the country", () => {
		expect(p.concepts["internet-ip"]).toMatchObject({ value: "ip" });
		expect(p.concepts["tethering-apn"]).toMatchObject({ value: "web.example" });
		expect(p.concepts["country-iso"]).toMatchObject({ value: "fr" });
	});

	it("reads the Mobile networks menu's switches, and keeps every leaf but passwords", () => {
		expect(p.concepts["volte-switch"]).toMatchObject({ kind: "value", value: false });
		expect(p.concepts["vonr-switch"]).toMatchObject({ kind: "value", value: true });
		expect(p.concepts["apn-internet"]).toMatchObject({ value: "web.example" });
		expect(p.raw["customer.xml:Settings.Connections.Profile[0].PSparam.APN"]).toBe("web.example");
		expect(Object.keys(p.raw).some((k) => k.endsWith("Password"))).toBe(false);
	});
});

describe("a Galaxy's IMS defaults", () => {
	/** The operator's entry turns IMS and VoLTE on; the service's defaults turn Wi-Fi Calling on and video calling off, and set Ut. */
	const maps = readIms(
		new Map([
			[
				"mnomap.json",
				text(
					`{ "mnomap": [ { "mccmnc": "20810", "subset": "", "gid1": "", "gid2": "", "spname": "", "mnoname": "NET_FR" } ] }`,
				),
			],
			[
				"imsswitch.json",
				text(`{ "defaultswitch": { "enableIms": false, "enableServiceVowifi": true, "enableServiceVilte": false },
    "imsswitch": [ { "mnoname": "NET_FR", "enableIms": true, "enableServiceVolte": true } ] }`),
			],
			[
				"globalsettings.json",
				text(`{ "defaultsetting": { "ss_domain_setting": "PS" }, "globalsetting": [] }`),
			],
			["imsprofile.json", text(`{ "profile": [] }`)],
		]),
	);
	const galaxy = samsungProfile(openOmc(packOmc(files, imsOperator(omcInfo, maps))), XYZ, "galaxy");

	it("reads the pack's concepts from its operator's own entry alone", () => {
		expect(galaxy.concepts.volte).toMatchObject({ kind: "state", state: "on" });
		expect(galaxy.concepts["wifi-calling"]).toEqual({ kind: "unset" });
		expect(galaxy.concepts["ss-over-ut"]).toEqual({ kind: "unset" });
	});

	it("gives a phone what the entry leaves unset from the IMS service's defaults, marked as theirs", () => {
		const [phone] = phoneStates(new Map([["SM-S931B", { sha: "galaxy", base: null }]]), () => galaxy, [
			{ code: "SM-S931B", boards: [], has5g: true },
		]);
		expect(phone?.states).toMatchObject({ volte: "on", "wifi-calling": "on", "video-calling": "no" });
		expect(phone?.defaults).toEqual({
			"wifi-calling": { layer: "imsservice", part: "rest" },
			"video-calling": { layer: "imsservice", part: "rest" },
		});
	});
});
