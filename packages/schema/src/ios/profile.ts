/** Apple bundle -> Profile: carrier.plist's settings; each board's override file and each MVNO configuration is a variant. */

import { canonical } from "@carrier-explode/values";
import {
	decodeFile,
	decodedPlist,
	flattenBundle,
	isJsonDict,
	type BundleFile,
	type OpenedBundle,
} from "@carrier-explode/decode-ios";
import { toJson } from "../json.ts";
import { uniqueSims } from "../sims.ts";
import {
	PROFILE_SCHEMA,
	type Apn,
	type ConceptValue,
	type Json,
	type Profile,
	type ProfileVariant,
	type SourceRef,
} from "../types.ts";
import { readingKey, text } from "../values.ts";
import { iosApns } from "./apns.ts";
import { iosIso, supportedSims } from "./identity.ts";
import { iosConcepts } from "./readers.ts";
import { mvnoConfigurations, settings, withLayer, type Layer, type Settings } from "./settings.ts";

/** A member as a dictionary; a broken or absent one contributes nothing, as on the phone. */
function plistDict(b: OpenedBundle, path: string): Readonly<Record<string, unknown>> | undefined {
	if (!b.info.files.some((f) => f.path === path)) return undefined;
	const v = decodedPlist(decodeFile(b, path));
	return isJsonDict(v) ? v : undefined;
}

interface PhoneFile {
	readonly file: BundleFile;
	readonly layer: Layer;
}

/** `overrides_<boards>.plist` files, by path. */
function phoneFiles(b: OpenedBundle): PhoneFile[] {
	return b.info.files
		.filter((f) => /^overrides_.+\.plist$/.test(f.path))
		.flatMap((file) => {
			const dict = plistDict(b, file.path);
			return dict === undefined ? [] : [{ file, layer: { file: file.path, prefix: "", dict } }];
		})
		.toSorted((x, y) => x.file.path.localeCompare(y.file.path));
}

interface Mapped {
	readonly concepts: Readonly<Record<string, ConceptValue>>;
	readonly apns: readonly Apn[];
}

function mapSettings(s: Settings, kind: SourceRef["kind"]): Mapped {
	const apns = iosApns(s);
	const all = iosConcepts({ settings: s, apns });
	// Country bundles carry place settings only; carrier features would read "no" throughout.
	const concepts =
		kind === "country" ? Object.fromEntries(Object.entries(all).filter(([, v]) => v.kind === "value")) : all;
	return { concepts, apns };
}

const apnText = (apns: readonly Apn[]): string =>
	canonical(apns.map((a) => toJson({ ...a, path: "" }) ?? null));

/**
 * The name the bundle shows in the status bar: StatusBarImages maps each name a network broadcasts to one shown, and
 * the one most entries show is the carrier's (TIM_br shows TIM for three and VIVO for one).
 */
function statusBarName(merged: Readonly<Record<string, unknown>>): { readonly display?: string } {
	const images = merged["StatusBarImages"];
	const shown = (Array.isArray(images) ? images : []).flatMap((image: unknown) => {
		const name = isJsonDict(image) ? text(image["StatusBarCarrierName"]) : undefined;
		return name === undefined ? [] : [name];
	});
	const counts = Map.groupBy(shown, (name) => name);
	// Ties go to the earlier entry: Map keeps first-seen order and the sort is stable.
	const [top] = [...counts].toSorted(([, x], [, y]) => y.length - x.length);
	return top === undefined ? {} : { display: top[0] };
}

/** The concepts and APNs `other` changes; undefined when it changes none. */
function variant(
	id: string,
	when: ProfileVariant["when"],
	main: Mapped,
	other: Mapped,
): ProfileVariant | undefined {
	const concepts = Object.fromEntries(
		Object.entries(other.concepts).filter(([cid, v]) => {
			const m = main.concepts[cid];
			return m === undefined || readingKey(m) !== readingKey(v);
		}),
	);
	if (Object.keys(concepts).length === 0 && apnText(main.apns) === apnText(other.apns)) return undefined;
	return { id, when, concepts, apns: other.apns };
}

/** Every leaf of every decodable member, keyed `<file>:<path>`. */
function rawOf(b: OpenedBundle): Record<string, Json> {
	return Object.fromEntries(
		Object.entries(flattenBundle(b)).flatMap(([file, flat]) =>
			Object.entries(flat).map(([path, v]): [string, Json] => [`${file}:${path}`, toJson(v) ?? null]),
		),
	);
}

/** A phone's variant, by its override plist (`overrides_D83_D84.plist`). */
export const phoneVariantId = (plist: string): string => `phones:${plist}`;

export function iosProfile(bundle: OpenedBundle, source: SourceRef, sha: string): Profile {
	const main = settings([
		{ file: "carrier.plist", prefix: "", dict: plistDict(bundle, "carrier.plist") ?? {} },
	]);
	const mapped = mapSettings(main, source.kind);
	const mvnos = mvnoConfigurations(main);
	const sims = uniqueSims([
		...supportedSims(main.merged.SupportedSIMs),
		...mvnos.flatMap((m) => supportedSims(m.supportedSims)),
	]);
	const phones = phoneFiles(bundle).flatMap(
		(p) =>
			variant(
				phoneVariantId(p.file.path),
				{ kind: "board", boards: p.file.boards ?? [] },
				mapped,
				mapSettings(withLayer(main, p.layer), source.kind),
			) ?? [],
	);
	const carriers = mvnos.flatMap(
		(m) =>
			variant(
				`mvno:${m.name}`,
				{ kind: "sim", sims: supportedSims(m.supportedSims) },
				mapped,
				mapSettings(m.settings, source.kind),
			) ?? [],
	);
	return {
		schema: PROFILE_SCHEMA,
		source,
		sha,
		identity: { ...statusBarName(main.merged), iso: iosIso(source, main.merged, sims), sims },
		apns: mapped.apns,
		concepts: mapped.concepts,
		raw: rawOf(bundle),
		variants: [...phones, ...carriers],
	};
}
