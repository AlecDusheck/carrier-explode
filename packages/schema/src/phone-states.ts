/** What each phone an indexed release lists reads from a carrier source: the Features pages' table. */

import { pixelDefaults } from "./android/defaults.ts";
import type { LayeredStates } from "./layers.ts";
import { galaxyDefaults } from "./samsung/defaults.ts";
import { conceptById, needs5G, requiredFeatures } from "./concepts.ts";
import { newestOf, type DeviceOrder } from "./devices.ts";
import { boardProducts, productOf } from "./ios/boards.ts";
import { head, lineOf, linesOf, type SourceCopy, type TimelineEntry } from "./timeline.ts";
import {
	decoderFamily,
	type DecoderFamily,
	type Defaulted,
	type Device,
	type FeatureState,
	MAIN_LINE,
	type Platform,
	type Profile,
	type SourceKey,
	type SourceKind,
	type SourceRef,
} from "./types.ts";

/** A phone as the index records it; `has5g` null while its settings don't say, which keeps its 5G features. */
export interface Phone extends Pick<Device, "code" | "boards"> {
	readonly has5g: boolean | null;
}

/** What phone states read of a head's profile, and of the profile under it. */
export type PhoneProfile = Pick<Profile, "source" | "concepts" | "variants" | "apns" | "raw">;

/** The source a family's carrier files are read over, by the phone that ships both: a Pixel build's default.pb. */
const BASE_SOURCES = {
	apple: null,
	android: "android:default:default",
	samsung: null,
} as const satisfies Record<DecoderFamily, SourceKey | null>;

export const baseSource = (platform: Platform): SourceKey | null => BASE_SOURCES[decoderFamily(platform)];

/** A source's copies and the timeline derived from them, with the copies of its family's base source (none without one). */
export interface SourceHistory {
	readonly source: SourceRef;
	readonly copies: readonly SourceCopy[];
	readonly timeline: readonly TimelineEntry[];
	readonly order: DeviceOrder;
	readonly base: readonly SourceCopy[];
}

/** The sha of the profile a phone reads, and of the base profile its build ships under it. */
export interface PhoneHead {
	readonly sha: string;
	readonly base: string | null;
}

type ReleaseCopy = Extract<SourceCopy, { readonly kind: "release" }>;
const shippedCopies = (copies: readonly SourceCopy[]): ReleaseCopy[] =>
	copies.filter((c): c is ReleaseCopy => c.kind === "release");
const shippedOn = (c: ReleaseCopy): string => `${c.release.id}\n${c.line}`;

/** A Pixel reads the file the newest build carrying the source ships it, over that build's default.pb; an OTA update is not every phone's. */
function pixelHeads({ copies, base }: SourceHistory): Map<string, PhoneHead> {
	const shipped = shippedCopies(copies);
	const newest = shipped
		.map((c) => c.release.sortKey)
		.toSorted()
		.at(-1);
	const bases = new Map(shippedCopies(base).map((c) => [shippedOn(c), c.sha]));
	return new Map(
		shipped
			.filter((c) => c.release.sortKey === newest)
			.map((c) => [c.line, { sha: c.sha, base: bases.get(shippedOn(c)) ?? null }]),
	);
}

/** A Galaxy firmware is one model's, so each model reads its own line's newest pack. */
function galaxyHeads({ source, timeline, order }: SourceHistory): Map<string, PhoneHead> {
	return new Map(
		linesOf(source, timeline, order).flatMap((line) => {
			const [newest] = lineOf(timeline, line);
			return newest === undefined ? [] : [[line, { sha: newest.sha, base: null }] as const];
		}),
	);
}

/** Every iPhone reads the main line's head; its override file is a variant of it. */
function appleHeads(
	{ source, timeline, order }: SourceHistory,
	phones: readonly string[],
): Map<string, PhoneHead> {
	const at = head(source, timeline, order, MAIN_LINE);
	return new Map(at === undefined ? [] : phones.map((p) => [p, { sha: at.sha, base: null }]));
}

const HEADS = {
	apple: appleHeads,
	android: pixelHeads,
	samsung: galaxyHeads,
} as const satisfies Record<
	DecoderFamily,
	(h: SourceHistory, phones: readonly string[]) => Map<string, PhoneHead>
>;

/** The kind of source phones read feature states from. */
const PHONE_SOURCE_KIND = "carrier" satisfies SourceKind;

/** Whether each phone reads `concept` of a `kind` source its own way (board overrides, its radio), so scans read phone states. */
export const perPhone = (kind: SourceKind, concept: string): boolean =>
	kind === PHONE_SOURCE_KIND && conceptById(concept)?.type === "state";

/** The base profile under a source as the newest phone reading it reads it: what its unset keys come from. */
export function sourceBase(heads: ReadonlyMap<string, PhoneHead>, order: DeviceOrder): string | null {
	const newest = newestOf(order, [...heads.keys()]);
	return newest === undefined ? null : (heads.get(newest)?.base ?? null);
}

/** What each phone reads from a carrier source; nothing from other sources, nor for a phone it ships nothing for. */
export function phoneHeads(history: SourceHistory, phones: readonly string[]): Map<string, PhoneHead> {
	if (history.source.kind !== PHONE_SOURCE_KIND) return new Map();
	const heads = HEADS[decoderFamily(history.source.platform)](history, phones);
	return new Map(
		phones.flatMap((p) => {
			const at = heads.get(p);
			return at === undefined ? [] : [[p, at] as const];
		}),
	);
}

const DEFAULTS: Readonly<
	Record<DecoderFamily, (carrier: PhoneProfile, base: PhoneProfile | null) => LayeredStates>
> = {
	apple: () => ({}),
	android: pixelDefaults,
	samsung: galaxyDefaults,
};

const statesOf = (concepts: PhoneProfile["concepts"]): Record<string, FeatureState> =>
	Object.fromEntries(
		Object.entries(concepts).flatMap(([id, v]) => (v.kind === "state" ? [[id, v.state]] : [])),
	);

/** One phone's feature states, and what of each the carrier leaves unset which layer under it decided. */
export interface PhoneStates {
	readonly device: string;
	readonly states: Readonly<Record<string, FeatureState>>;
	readonly defaults: Readonly<Record<string, Defaulted>>;
}

/**
 * Each phone's feature states: its profile's, with the override file for its board on top, then what the layers under
 * it give the rest; off without a 5G radio for a 5G feature, or without a feature it rides on, which no layer decides.
 */
export function phoneStates(
	heads: ReadonlyMap<string, PhoneHead>,
	profileOf: (sha: string) => PhoneProfile | undefined,
	phones: readonly Phone[],
): PhoneStates[] {
	const products = boardProducts(phones);
	const mustProfile = (phone: string, sha: string): PhoneProfile => {
		const profile = profileOf(sha);
		if (profile === undefined)
			throw new Error(`phone states: ${phone} reads ${sha}, which no profile was given for`);
		return profile;
	};
	return phones.flatMap((phone) => {
		const at = heads.get(phone.code);
		if (at === undefined) return [];
		const profile = mustProfile(phone.code, at.sha);
		const base = at.base === null ? null : mustProfile(phone.code, at.base);
		const own = profile.variants.find(
			(v) => v.when.kind === "board" && v.when.boards.some((b) => productOf(products, b) === phone.code),
		);
		const defaulted = Object.entries(DEFAULTS[decoderFamily(profile.source.platform)](profile, base));
		const states: Readonly<Record<string, FeatureState>> = {
			...Object.fromEntries(defaulted.map(([id, d]) => [id, d.state])),
			...statesOf(profile.concepts),
			...statesOf(own?.concepts ?? {}),
		};
		const ruledOut = (id: string): boolean =>
			(phone.has5g === false && needs5G(id)) || requiredFeatures(id).some((r) => states[r] === "no");
		return [
			{
				device: phone.code,
				states: Object.fromEntries(
					Object.entries(states).map(([id, state]) => [id, ruledOut(id) ? "no" : state]),
				),
				defaults: Object.fromEntries(
					defaulted.flatMap(([id, d]) => (ruledOut(id) ? [] : [[id, d.defaulted]])),
				),
			},
		];
	});
}
