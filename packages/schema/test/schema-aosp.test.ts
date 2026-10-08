import { describe, expect, it } from "vitest";
import type { CarrierSettings } from "@carrier-explode/decode-android";
import {
	apnElements,
	carrierConfigElements,
	pixelApns,
	pixelConfigBody,
	profileApns,
	type SimRule,
} from "../src/index.ts";

const cs: CarrierSettings = {
	canonicalName: "test_us",
	apns: [
		{
			name: "Internet & MMS",
			value: "fast.example",
			type: ["DEFAULT", "MMS", "ALL"],
			protocol: "NON_IP",
			authtype: -1,
			bearerBitmask: "14|20",
			password: "secret",
			skip464xlat: "SKIP_464XLAT_DISABLE",
			infrastructureBitmask: 3,
		},
	],
	configs: {
		carrier_volte_available_bool: { kind: "bool", value: true },
		some_long: { kind: "long", value: "9007199254740993" },
		"imsvoice.audio_codec_capability_payload_types_bundle": {
			kind: "bundle",
			value: { "imsvoice.amrwb_payload_type_int_array": { kind: "int_array", value: [104, 105] } },
		},
		carrier_name_string: { kind: "text", value: "A<B" },
	},
	vendorConfigs: [],
	unknown: [],
};

const rules: SimRule[] = [
	{ by: "plmn", sim: { mccmnc: "310260" } },
	{ by: "plmn", sim: { mccmnc: "31026", gid1: "6D" } },
	{ by: "plmn", sim: { mccmnc: "310260", spn: "A.B", imsiPrefix: "3102601" } },
	{ by: "plmn", sim: { mccmnc: "310260", gid2: "01" } },
	{ by: "plmn", sim: { mccmnc: "310260", iccidPrefix: "8901" } },
	{ by: "iccid", prefix: "8901" },
	{ by: "carrierId", id: "310VZW" },
];

describe("AOSP XML", () => {
	it("writes a Pixel APN once per rule apns-conf.xml can state, with its password", () => {
		const xml = apnElements(rules, pixelApns(cs, "test_us"));
		expect(xml.split("\n").filter(Boolean)).toEqual([
			'  <apn carrier="Internet &amp; MMS" mcc="310" mnc="260" apn="fast.example" type="default,mms,*" bearer_bitmask="14|20" infrastructure_bitmask="cellular|satellite" protocol="NON-IP" password="secret" skip_464xlat="0"/>',
			'  <apn carrier="Internet &amp; MMS" mcc="310" mnc="26" mvno_type="gid" mvno_match_data="6D" apn="fast.example" type="default,mms,*" bearer_bitmask="14|20" infrastructure_bitmask="cellular|satellite" protocol="NON-IP" password="secret" skip_464xlat="0"/>',
			'  <apn carrier="Internet &amp; MMS" mcc="310" mnc="260" mvno_type="iccid" mvno_match_data="8901" apn="fast.example" type="default,mms,*" bearer_bitmask="14|20" infrastructure_bitmask="cellular|satellite" protocol="NON-IP" password="secret" skip_464xlat="0"/>',
		]);
	});

	it("writes a bundle per rule CarrierConfig can state, each config typed as the proto states it", () => {
		const xml = carrierConfigElements("test_us", rules.slice(2, 3), pixelConfigBody(cs));
		expect(xml).toBe(
			[
				'  <carrier_config name="test_us" mcc="310" mnc="260" spn="A\\.B" imsi="3102601.*">',
				'    <boolean name="carrier_volte_available_bool" value="true"/>',
				'    <long name="some_long" value="9007199254740993"/>',
				'    <pbundle_as_map name="imsvoice.audio_codec_capability_payload_types_bundle">',
				'      <int-array name="imsvoice.amrwb_payload_type_int_array" num="2">',
				'        <item value="104"/>',
				'        <item value="105"/>',
				"      </int-array>",
				"    </pbundle_as_map>",
				'    <string name="carrier_name_string">A&lt;B</string>',
				"  </carrier_config>",
				"",
			].join("\n"),
		);
		expect(carrierConfigElements("default", "every SIM", "")).toBe(
			'  <carrier_config name="default">\n  </carrier_config>\n',
		);
	});

	it("names a decoded APN by its label, else its source", () => {
		const xml = apnElements(
			rules.slice(0, 1),
			profileApns([{ apn: "a", types: ["ims"], password: "p", auth: "chap", path: "p" }], "TMB"),
		);
		expect(xml).toBe(
			'  <apn carrier="TMB" mcc="310" mnc="260" apn="a" type="ims" authtype="2" password="p"/>\n',
		);
	});
});
