/**
 * The pack's feature switches: cscfeature.xml (`CscFeature_*`, for the whole pack) and customer_carrier_feature.json
 * (`CarrierFeature_*`, per carrier group and per Samsung carrier id).
 */

import { isRecord } from "@carrier-explode/values";
import * as v from "valibot";

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
	/** The Samsung carrier list version the ids below refer to (omc.info's carrierListVersion); older files have none. */
	readonly carrierListVersion?: string;
	/** By carrier group: `SFR`. */
	readonly groups: ReadonlyArray<{ readonly group: string; readonly features: Features }>;
	/** By Samsung carrier id: one network or MVNO of the pack. */
	readonly carriers: ReadonlyArray<{ readonly id: string; readonly features: Features }>;
}

export class CarrierFeatureError extends Error {
	override name = "CarrierFeatureError";
}

const featureObject = v.custom<Readonly<Record<string, unknown>>>(isRecord, "expected a feature object");

const carrierFeatureSchema = v.object({
	version: v.string(),
	mapped_cid_version: v.exactOptional(v.string()),
	customer: v.exactOptional(v.array(v.object({ carrier_group: v.string(), feature: featureObject }))),
	specific: v.exactOptional(v.array(v.object({ canonical_id: v.string(), feature: featureObject }))),
});

const features = (f: Readonly<Record<string, unknown>>): Features =>
	Object.fromEntries(Object.entries(f).map(([k, x]) => [k, typeof x === "string" ? x : JSON.stringify(x)]));

export function decodeCarrierFeature(json: string): CarrierFeature {
	const doc = v.safeParse(carrierFeatureSchema, JSON.parse(json));
	if (!doc.success)
		throw new CarrierFeatureError(`customer_carrier_feature.json: ${v.summarize(doc.issues)}`);
	const { version, mapped_cid_version, customer = [], specific = [] } = doc.output;
	return {
		version,
		...(mapped_cid_version === undefined ? {} : { carrierListVersion: mapped_cid_version }),
		groups: customer.map((e) => ({ group: e.carrier_group, features: features(e.feature) })),
		carriers: specific.map((e) => ({ id: e.canonical_id, features: features(e.feature) })),
	};
}
