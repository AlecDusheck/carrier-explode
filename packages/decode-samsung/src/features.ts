/**
 * The pack's feature switches: cscfeature.xml (`CscFeature_*`, for the whole pack) and customer_carrier_feature.json
 * (`CarrierFeature_*`, per carrier group and per Samsung carrier id).
 */

import { isRecord } from "@carrier-explode/values";

import { child, childText, parseXml, XmlError } from "./xml.ts";

export type Features = Readonly<Record<string, string>>;

export interface CscFeature {
	readonly version?: string;
	readonly features: Features;
}

export function decodeCscFeature(xml: string): CscFeature {
	const root = parseXml(xml);
	const set = child(root, "FeatureSet");
	if (set === undefined) throw new XmlError("cscfeature.xml without a FeatureSet");
	const version = childText(root, "Version");
	return {
		...(version === undefined ? {} : { version }),
		features: Object.fromEntries(set.children.map((c) => [c.name, c.text])),
	};
}

export interface CarrierFeature {
	readonly version: string;
	/** The Samsung carrier list version the ids below refer to (omc.info's carrierListVersion). */
	readonly carrierListVersion: string;
	/** By carrier group: `SFR`. */
	readonly groups: ReadonlyArray<{ readonly group: string; readonly features: Features }>;
	/** By Samsung carrier id: one network or MVNO of the pack. */
	readonly carriers: ReadonlyArray<{ readonly id: string; readonly features: Features }>;
}

export class CarrierFeatureError extends Error {
	override name = "CarrierFeatureError";
}

function str(o: Readonly<Record<string, unknown>>, k: string): string {
	const v = o[k];
	if (typeof v !== "string")
		throw new CarrierFeatureError(`customer_carrier_feature.json: ${k} is not a string`);
	return v;
}

function features(o: Readonly<Record<string, unknown>>): Features {
	const f = o.feature;
	if (!isRecord(f))
		throw new CarrierFeatureError("customer_carrier_feature.json: an entry without a feature object");
	return Object.fromEntries(
		Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
	);
}

const entries = (
	o: Readonly<Record<string, unknown>>,
	k: string,
): Array<Readonly<Record<string, unknown>>> => {
	const v = o[k];
	if (v === undefined) return [];
	if (!Array.isArray(v) || !v.every(isRecord))
		throw new CarrierFeatureError(`customer_carrier_feature.json: ${k} is not a list of objects`);
	return v;
};

export function decodeCarrierFeature(json: string): CarrierFeature {
	const doc: unknown = JSON.parse(json);
	if (!isRecord(doc)) throw new CarrierFeatureError("customer_carrier_feature.json is not an object");
	return {
		version: str(doc, "version"),
		carrierListVersion: str(doc, "mapped_cid_version"),
		groups: entries(doc, "customer").map((e) => ({ group: str(e, "carrier_group"), features: features(e) })),
		carriers: entries(doc, "specific").map((e) => ({ id: str(e, "canonical_id"), features: features(e) })),
	};
}
