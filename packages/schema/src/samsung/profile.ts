/** A Samsung carrier pack → Profile. No variants: its per-carrier-id features stay in raw, keyed by id. */

import { PACK_FILES, type Pack, type XmlElement } from "@carrier-explode/decode-samsung";
import { PROFILE_SCHEMA, type Json, type NativeRef, type Profile, type SourceRef } from "../types.ts";
import { samsungApns } from "./apns.ts";
import { packSims } from "./identity.ts";
import { imsLeaves, ownIms } from "./ims.ts";
import { samsungConcepts } from "./readers.ts";

/** Every leaf of an XML element, by path below it, repeated elements indexed: `Settings.Connections.Profile[3].APN`. */
function xmlLeaves(e: XmlElement, path = ""): Array<[string, Json]> {
	const counts = new Map<string, number>();
	for (const c of e.children) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
	const seen = new Map<string, number>();
	return e.children.flatMap((c): Array<[string, Json]> => {
		const i = seen.get(c.name) ?? 0;
		seen.set(c.name, i + 1);
		const at = `${path ? `${path}.` : ""}${c.name}${(counts.get(c.name) ?? 0) > 1 ? `[${i}]` : ""}`;
		if (c.children.length) return xmlLeaves(c, at);
		// Passwords are never republished.
		return c.name === "Password" ? [] : [[at, c.text]];
	});
}

/** Every native leaf: `<file>:<path>`, the feature files' by group (`customer[SFR]`) or carrier id (`specific[30490]`). */
function rawOf(pack: Pack): Record<string, Json> {
	const out: Record<string, Json> = {};
	for (const [k, v] of pack.customer === undefined ? [] : xmlLeaves(pack.customer.root))
		out[`${PACK_FILES.customer}:${k}`] = v;
	for (const [k, v] of Object.entries(pack.cscFeature?.features ?? {}))
		out[`${PACK_FILES.cscFeature}:${k}`] = v;
	for (const g of pack.carrierFeature?.groups ?? [])
		for (const [k, v] of Object.entries(g.features))
			out[`${PACK_FILES.carrierFeature}:customer[${g.group}].${k}`] = v;
	for (const c of pack.carrierFeature?.carriers ?? [])
		for (const [k, v] of Object.entries(c.features))
			out[`${PACK_FILES.carrierFeature}:specific[${c.id}].${k}`] = v;
	out[`${PACK_FILES.omcInfo}:version`] = pack.omcInfo.version;
	for (const [k, v] of Object.entries(pack.omcInfo.catalog)) out[`${PACK_FILES.omcInfo}:catalog.${k}`] = v;
	return out;
}

/**
 * The switches the whole pack sets: cscfeature.xml's, then its carrier groups' CarrierFeatures over them, then a
 * per-carrier-id CarrierFeature the groups leave unset, when every carrier id that sets it agrees.
 */
function packFeatures(pack: Pack): Map<string, NativeRef> {
	const out = new Map<string, NativeRef>();
	for (const [k, value] of Object.entries(pack.cscFeature?.features ?? {}))
		out.set(k, { path: `${PACK_FILES.cscFeature}:${k}`, value });
	for (const g of pack.carrierFeature?.groups ?? []) {
		for (const [k, value] of Object.entries(g.features))
			out.set(k, { path: `${PACK_FILES.carrierFeature}:customer[${g.group}].${k}`, value });
	}
	const specific = new Map<string, NativeRef[]>();
	for (const c of pack.carrierFeature?.carriers ?? []) {
		for (const [k, value] of Object.entries(c.features))
			specific.set(k, [
				...(specific.get(k) ?? []),
				{ path: `${PACK_FILES.carrierFeature}:specific[${c.id}].${k}`, value },
			]);
	}
	for (const [k, refs] of specific) {
		const [first] = refs;
		if (!out.has(k) && first !== undefined && refs.every((r) => r.value === first.value)) out.set(k, first);
	}
	return out;
}

export function samsungProfile(pack: Pack, source: SourceRef, sha: string): Profile {
	const apns = samsungApns(pack.customer?.profiles ?? [], pack.customer?.handles ?? []);
	const iso = pack.customer?.countryIso;
	const raw = { ...rawOf(pack), ...imsLeaves(pack.ims) };
	return {
		schema: PROFILE_SCHEMA,
		source,
		sha,
		identity: { iso: iso === undefined ? [] : [iso.toLowerCase()], sims: packSims(pack.omcInfo.carriers) },
		apns,
		concepts: samsungConcepts({
			apns,
			features: packFeatures(pack),
			ims: ownIms(raw),
			countryIso: iso,
			customer: new Map(pack.customer === undefined ? [] : xmlLeaves(pack.customer.root)),
		}),
		raw,
		variants: [],
	};
}
