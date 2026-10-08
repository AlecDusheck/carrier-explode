// Synthetic packs in the layout of Galaxy S25 firmware's (S931BOXMCCZH1, S931U1OYMCCZF9): the files' shapes, not their
// contents. The OMC text encoding is applied by encode(), the inverse of decodeOmcText.

import { gzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
	decodeOmcText,
	mnoName,
	mnoRule,
	omcVersion,
	imsOperator,
	openOmc,
	packOmc,
	readIms,
	parseJsonc,
	parseXml,
	PACK_FILES,
	xmlValue,
	type ImsSim,
} from "../src/index.ts";
import { OMC_TABLES } from "../src/omc-text.ts";

/** Samsung's encoding: gzip, XOR with the salt, rotate right by the shift. */
function encode(text: string): Uint8Array {
	const z = gzipSync(new TextEncoder().encode(text));
	return z.map((b, i) => {
		const x = b ^ (OMC_TABLES.salts[i % 256] ?? 0);
		const s = OMC_TABLES.shifts[i % 256] ?? 0;
		return ((x >>> s) | (x << (8 - s))) & 0xff;
	});
}

const OMC_INFO = `<?xml version="1.0" encoding="UTF-8"?>
<omcInfo><version>SAOMC_SM-S931B_OXM_XYZ_16_0007</version><model><name>SM-S931B</name></model>
  <catalog><customer>yes</customer><carrierListVersion>160027</carrierListVersion></catalog>
  <carrierList><carrierCount>3</carrierCount>
    <carrier><mcc>208</mcc><mnc>10</mnc><networkName>Net</networkName></carrier>
    <carrier><mcc>208</mcc><mnc>10</mnc><spn>Mvno.</spn><codeType>HEX</codeType><gid>434F5249</gid><iccid>893327</iccid><networkName>Mvno</networkName></carrier>
    <carrier><mcc>206</mcc><mnc>01</mnc><codeType>DEC</codeType><gid>117</gid><networkName>Dec</networkName></carrier>
  </carrierList></omcInfo>`;

const CUSTOMER = `<?xml version="1.0" encoding="UTF-8"?>
<CustomerData><GeneralInfo><Country>France</Country><CountryISO>FR</CountryISO><SalesCode>XYZ</SalesCode></GeneralInfo>
<Settings><Connections>
  <ProfileHandle><NetworkName>Net</NetworkName><ProfBrowser>Web</ProfBrowser><ProfMMS>MMS &amp; more</ProfMMS><ProfEmail>Web</ProfEmail></ProfileHandle>
  <Profile><NetworkName>Net</NetworkName><ProfileName>Web</ProfileName><Auth>normal</Auth><IpVersion>ipv4v6</IpVersion>
    <Proxy><EnableFlag>off</EnableFlag><Port>0</Port></Proxy><PSparam><APN>web.example</APN><UserId>u</UserId><Password>p</Password></PSparam></Profile>
  <Profile><NetworkName>Net</NetworkName><ProfileName>MMS &amp; more</ProfileName><URL>http://mms.example</URL><HiddenStatus>hidden</HiddenStatus>
    <Proxy><EnableFlag>on</EnableFlag><ServAddr>10.0.0.1</ServAddr><Port>8080</Port></Proxy><PSparam><APN>mms.example</APN></PSparam></Profile>
</Connections></Settings></CustomerData>`;

const CSC_FEATURE = `<?xml version='1.0' encoding='utf-8'?><SamsungMobileFeature><Version>ED00011</Version>
<FeatureSet><CscFeature_RIL_ConfigWbamr>2G</CscFeature_RIL_ConfigWbamr></FeatureSet></SamsungMobileFeature>`;

const CARRIER_FEATURE = JSON.stringify({
	version: "11",
	mapped_cid_version: "160027",
	customer: [{ carrier_group: "XYZ", feature: { CarrierFeature_RIL_SupportVolte: "TRUE" } }],
	specific: [
		{
			canonical_id: "30643",
			feature: { CarrierFeature_VoiceCall_ConfigOpStyleMobileNetworkSettingMenu: "-voltecall,+vonrcall" },
		},
	],
});

const files = new Map<string, Uint8Array>([
	[PACK_FILES.omcInfo, new TextEncoder().encode(OMC_INFO)],
	[PACK_FILES.customer, new TextEncoder().encode(CUSTOMER)],
	[PACK_FILES.cscFeature, encode(CSC_FEATURE)],
	[PACK_FILES.carrierFeature, encode(CARRIER_FEATURE)],
]);

describe("decodeOmcText", () => {
	it("decodes Samsung's encoding, and passes plain XML and JSON through", () => {
		expect(decodeOmcText(encode("<a>é</a>"))).toBe("<a>é</a>");
		expect(decodeOmcText(new TextEncoder().encode('{"a":1}'))).toBe('{"a":1}');
	});
});

describe("a carrier pack", () => {
	it("packs to the same bytes whatever order its files come in", () => {
		expect(packOmc(files, null)).toEqual(packOmc(new Map([...files].toReversed()), null));
	});

	const pack = openOmc(packOmc(files, null));

	it("keeps its IMS operator, null for none", () => {
		expect(pack.ims).toBeNull();
		const op = {
			mno: "NET_FR",
			switches: { enableIms: true },
			profile: null,
			settings: { ss_domain_setting: "PS_ALWAYS" },
			defaults: { switches: { enableIms: false }, settings: {} },
		};
		expect(openOmc(packOmc(files, op)).ims).toEqual(op);
	});

	it("reads omc.info's version and SIM rules", () => {
		expect(pack.omcInfo.model).toBe("SM-S931B");
		expect(omcVersion(pack.omcInfo)).toBe("16.0007");
		expect(pack.omcInfo.carriers[1]).toEqual({
			mcc: "208",
			mnc: "10",
			networkName: "Mvno",
			spn: "Mvno.",
			codeType: "HEX",
			gid: "434F5249",
			iccid: "893327",
		});
	});

	it("reads customer.xml's profiles, their roles, proxies and passwords", () => {
		const c = pack.customer;
		expect(c?.countryIso).toBe("FR");
		expect(c?.handles).toEqual([
			{ networkName: "Net", roles: { ProfBrowser: "Web", ProfMMS: "MMS & more", ProfEmail: "Web" } },
		]);
		expect(c?.profiles[0]).toEqual({
			index: 0,
			networkName: "Net",
			name: "Web",
			apn: "web.example",
			auth: "normal",
			user: "u",
			password: "p",
			ipVersion: "ipv4v6",
		});
		expect(c?.profiles[1]).toMatchObject({
			name: "MMS & more",
			url: "http://mms.example",
			proxy: { host: "10.0.0.1", port: "8080" },
			hidden: true,
		});
	});

	it("decodes both feature files", () => {
		expect(pack.cscFeature).toEqual({ version: "ED00011", features: { CscFeature_RIL_ConfigWbamr: "2G" } });
		expect(pack.carrierFeature?.groups).toEqual([
			{ group: "XYZ", features: { CarrierFeature_RIL_SupportVolte: "TRUE" } },
		]);
		expect(pack.carrierFeature?.carriers[0]?.id).toBe("30643");
	});
});

describe("parseXml", () => {
	it("refuses a tag closed out of order, and a file cut short", () => {
		expect(() => parseXml("<a><b></a></b>")).toThrow(/closes/);
		expect(() => parseXml("<a><!-- open")).toThrow(/after/);
	});
});

describe("xmlValue", () => {
	it("reads leaves as text and repeated names as lists", () => {
		const e = parseXml("<a><b>1</b><c><d>x</d></c><e>2</e><e>3</e></a>");
		expect(xmlValue(e)).toEqual({ b: "1", c: { d: "x" }, e: ["2", "3"] });
	});
});

const json = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

describe("IMS maps", () => {
	const maps = readIms(
		new Map([
			[
				"mnomap.json",
				json({
					mnomap: [
						{ mccmnc: "20810", subset: "", gid1: "", gid2: "", spname: "", mnoname: "NET_FR@BLOCKGC" },
						{ mccmnc: "20810", subset: "", gid1: "4e", gid2: "", spname: "", mnoname: "MVNO_FR" },
						{ mccmnc: "20810", subset: "9", gid1: "4E", gid2: "", spname: "", mnoname: "SUB_FR" },
						{
							mccmnc: "20810",
							subset: "",
							gid1: "6538",
							gid2: "6539",
							spname: "",
							mnoname: "ROAM_US@BLOCKGC",
						},
						{ mccmnc: "313340", subset: "", gid1: "", gid2: "", spname: "", mnoname: "ROAM_US" },
					],
				}),
			],
			[
				"imsswitch.json",
				json({
					defaultswitch: { enableIms: false },
					imsswitch: [
						{ mnoname: "NET_FR", enableIms: true },
						{ mnoname: "ROAM_US", enableIms: true },
					],
				}),
			],
			[
				"imsprofile.json",
				json({
					profile: [
						{ mnoname: "NET_FR", pdn: "ims" },
						{ mnoname: "NET_FR", pdn: "emergency" },
					],
				}),
			],
			[
				"globalsettings.json",
				json({
					defaultsetting: { ss_domain_setting: "CS", emergency_domain_setting: "CS" },
					globalsetting: [{ mnoname: "NET_FR", ss_domain_setting: "PS_ALWAYS" }],
				}),
			],
		]),
	);

	it("keeps // inside strings and drops it outside", () => {
		expect(parseJsonc(`{ "u": "http://x//y" } // note`)).toEqual({ u: "http://x//y" });
	});

	const name = (sim: ImsSim): string | undefined => {
		const r = mnoRule(maps, sim);
		return r && mnoName(r);
	};

	it("picks the most qualified rule the SIM meets", () => {
		expect(name({ mccmnc: "20810" })).toBe("NET_FR");
		expect(name({ mccmnc: "20810", gid1: "4E01" })).toBe("MVNO_FR");
		expect(name({ mccmnc: "20810", gid1: "4e01", imsi: "208109123" })).toBe("SUB_FR");
		expect(name({ mccmnc: "20820" })).toBeUndefined();
	});

	it("takes a qualifier a pack's rule leaves out as open, so a rule naming its GID1 beats the bare network code", () => {
		expect(name({ mccmnc: "20810", gid1: "6538" })).toBe("ROAM_US");
		expect(name({ mccmnc: "20810", gid1: "6538", gid2: "6530" })).toBe("NET_FR");
		const carriers = [
			["208", "10"],
			["208", "10"],
			["313", "340"],
		].map(([mcc = "", mnc = ""]) => ({ mcc, mnc, gid: "6538", codeType: "HEX" }));
		const info = { version: "v", model: "m", catalog: {}, carriers };
		expect(imsOperator(info, maps)?.mno).toBe("ROAM_US");
	});

	it("keeps each operator's entries apart from the service's defaults, and groups profiles by operator", () => {
		expect(maps.switches.get("NET_FR")).toEqual({ enableIms: true, mnoname: "NET_FR" });
		expect(maps.defaults).toEqual({
			switches: { enableIms: false },
			settings: { ss_domain_setting: "CS", emergency_domain_setting: "CS" },
		});
		expect(maps.profiles.get("NET_FR")).toHaveLength(2);
	});

	it("names a pack's operator by most of its SIM rules, with its switches and first profile", () => {
		const info = {
			version: "v",
			model: "m",
			catalog: {},
			carriers: [
				{ mcc: "208", mnc: "10" },
				{ mcc: "208", mnc: "10", gid: "4E", codeType: "HEX" },
				{ mcc: "208", mnc: "10" },
			],
		};
		expect(imsOperator(info, maps)).toEqual({
			mno: "NET_FR",
			switches: { enableIms: true, mnoname: "NET_FR" },
			profile: { mnoname: "NET_FR", pdn: "ims" },
			settings: { mnoname: "NET_FR", ss_domain_setting: "PS_ALWAYS" },
			defaults: maps.defaults,
		});
		expect(imsOperator({ ...info, carriers: [{ mcc: "208", mnc: "20" }] }, maps)).toBeNull();
	});
});
