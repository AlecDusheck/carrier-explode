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
		return c.children.length ? xmlLeaves(c, at) : [[at, c.text]];
	});
}

type Keyed = ReadonlyArray<readonly [string, NativeRef]>;

/** The pack's native leaves, each by its key in its file and with its `<file>:<path>`. */
interface PackRefs {
	/** customer.xml's, by path below its root. */
	readonly customer: Keyed;
	readonly cscFeature: Keyed;
	/** The CarrierFeatures of each carrier group (`customer[SFR]`). */
	readonly groups: Keyed;
	/** The CarrierFeatures of each carrier id (`specific[30490]`). */
	readonly specific: Keyed;
}

const keyed = (file: string, prefix: string, leaves: Iterable<readonly [string, Json]>): Keyed =>
	[...leaves].map(([k, value]) => [k, { path: `${file}:${prefix}${k}`, value }]);

function packRefs(pack: Pack): PackRefs {
	const features = pack.carrierFeature;
	return {
		customer: keyed(
			PACK_FILES.customer,
			"",
			pack.customer === undefined ? [] : xmlLeaves(pack.customer.root),
		),
		cscFeature: keyed(PACK_FILES.cscFeature, "", Object.entries(pack.cscFeature?.features ?? {})),
		groups: (features?.groups ?? []).flatMap((g) =>
			keyed(PACK_FILES.carrierFeature, `customer[${g.group}].`, Object.entries(g.features)),
		),
		specific: (features?.carriers ?? []).flatMap((c) =>
			keyed(PACK_FILES.carrierFeature, `specific[${c.id}].`, Object.entries(c.features)),
		),
	};
}

/** Every native leaf, by its `<file>:<path>`. */
function rawOf(pack: Pack, refs: PackRefs): Record<string, Json> {
	const out: Record<string, Json> = {};
	for (const [, ref] of [...refs.customer, ...refs.cscFeature, ...refs.groups, ...refs.specific])
		out[ref.path] = ref.value;
	out[`${PACK_FILES.omcInfo}:version`] = pack.omcInfo.version;
	for (const [k, v] of Object.entries(pack.omcInfo.catalog)) out[`${PACK_FILES.omcInfo}:catalog.${k}`] = v;
	return out;
}

/**
 * The switches the whole pack sets: cscfeature.xml's, then its carrier groups' CarrierFeatures over them, then a
 * per-carrier-id CarrierFeature the groups leave unset, when every carrier id that sets it agrees.
 */
function packFeatures(refs: PackRefs): Map<string, NativeRef> {
	const out = new Map([...refs.cscFeature, ...refs.groups]);
	const specific = Map.groupBy(refs.specific, ([k]) => k);
	for (const [k, entries] of specific) {
		const [first] = entries;
		if (!out.has(k) && first !== undefined && entries.every(([, r]) => r.value === first[1].value))
			out.set(k, first[1]);
	}
	return out;
}

export function samsungProfile(pack: Pack, source: SourceRef, sha: string): Profile {
	const apns = samsungApns(pack.customer?.profiles ?? [], pack.customer?.handles ?? []);
	const iso = pack.customer?.countryIso;
	const refs = packRefs(pack);
	const raw = { ...rawOf(pack, refs), ...(pack.ims === null ? {} : imsLeaves(pack.ims)) };
	return {
		schema: PROFILE_SCHEMA,
		source,
		sha,
		identity: { iso: iso === undefined ? [] : [iso.toLowerCase()], sims: packSims(pack.omcInfo.carriers) },
		apns,
		concepts: samsungConcepts({
			apns,
			features: packFeatures(refs),
			ims: ownIms(raw),
			countryIso: iso,
			customer: new Map(refs.customer),
		}),
		raw,
		variants: [],
	};
}
