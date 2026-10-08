/** Links sources into carriers by exact shared SIM rules (matcherKeys), with people's link and split rules, each with its reason. */

import { androidDisplay, androidIso, isRuleNamed } from "./android/names.ts";
import { assignIds } from "./ids.ts";
import { appleDisplay, appleNameIso } from "./ios/names.ts";
import {
	APPLE_PLATFORMS,
	decoderFamily,
	parseRuleKey,
	PLATFORMS,
	sourceKey,
	sourceOf,
	type DecoderFamily,
	type Platform,
	type SourceKey,
	type SourceRef,
} from "./types.ts";

/** What linking reads of a source: its head's identity, and the SIM rules (matcherKeys) its platform's routing (Apple's OTA manifest, a Pixel's carrier list) sends it. */
export interface SourceIdentity {
	readonly key: SourceKey;
	readonly display: string | null;
	readonly iso: readonly string[];
	readonly sims: readonly string[];
	readonly routes: readonly string[];
}

const RULE_NAMED = {
	apple: () => false,
	android: isRuleNamed,
	samsung: () => false,
} as const satisfies Record<DecoderFamily, (name: string) => boolean>;

/** A carrier source named only by the SIM rule that selects it, whose carrier has no name either: no carrier to list. */
export const isUnnamedRule = (ref: SourceRef, carrierNamed: boolean): boolean =>
	ref.kind === "carrier" && !carrierNamed && RULE_NAMED[decoderFamily(ref.platform)](ref.name);

/** `link` joins two sources keyed differently; `split` keeps two apart. A split naming an Apple bundle covers its iPad and Watch files too. */
export const LINK_RULES = ["link", "split"] as const;

export interface LinkRule {
	readonly a: SourceKey;
	readonly b: SourceKey;
	readonly rule: (typeof LINK_RULES)[number];
	readonly why: string;
}

/** A carrier, and the carrier of each source it links; country bundles are not carriers. */
export interface Carrier {
	readonly id: string;
	/** The data's name for it; null when the data names it only by one of its sources' names. */
	readonly name: string | null;
	readonly iso: string | null;
}

export interface Linked {
	readonly carriers: readonly Carrier[];
	readonly members: Readonly<Partial<Record<SourceKey, string>>>;
}

interface Member {
	readonly key: SourceKey;
	readonly source: SourceRef;
	/** Distinct matcherKeys that identify a carrier. */
	readonly sims: readonly string[];
	readonly display: string;
	readonly iso: readonly string[];
}

/** A carrier before it has an id. */
interface LinkedGroup {
	readonly name: string;
	readonly iso: string | undefined;
	readonly members: readonly Member[];
}

/** A source's name and countries as its name alone gives them, for a head that states none. */
const NAMED = {
	android: (s) => ({ display: androidDisplay(s.name, undefined), iso: androidIso(s.name) }),
	// A sales code says nothing of its country; its profile does.
	samsung: (s) => ({ display: s.name, iso: [] }),
	apple: (s) => {
		const iso = appleNameIso(s);
		return { display: appleDisplay(s), iso: iso === undefined ? [] : [iso] };
	},
} as const satisfies Record<
	DecoderFamily,
	(s: SourceRef) => { readonly display: string; readonly iso: readonly string[] }
>;

/**
 * MCCs no network is assigned: ITU-T E.212's list (Annex to ITU OB 1117, note a) reserves those starting 0, 1 and 8, and
 * E.212 (06/2024) Appendix III gives 999 to any private network. Test SIMs (00101, 99999) use them, so they say nothing of a carrier.
 */
const unassignedMcc = (mcc: string): boolean => /^[018]/.test(mcc) || mcc === "999";

/**
 * The network 3GPP's terminal conformance tests simulate: TS 31.121 (V4.1.0, 4.1.1) gives its default test UICC the IMSI
 * 246 081… and its simulated cells LAI 246/081 and 246/81. Test equipment broadcasts it, so it too says nothing of a carrier.
 */
const CONFORMANCE_TEST_PLMNS: ReadonlySet<string> = new Set(["246081", "24681"]);

/** Whether an MCC-MNC is a test SIM's or test equipment's: on an unassigned MCC, or the conformance test network. */
export const isTestPlmn = (mccmnc: string): boolean =>
	unassignedMcc(mccmnc.slice(0, 3)) || CONFORMANCE_TEST_PLMNS.has(mccmnc);

/** Whether a rule can say two sources are one carrier, or select a carrier's modem configuration: all but test PLMN rules. */
export function identifies(key: string): boolean {
	const rule = parseRuleKey(key);
	return rule?.by !== "plmn" || !isTestPlmn(rule.sim.mccmnc);
}

function memberOf(s: SourceIdentity): Member {
	const source = sourceOf(s.key);
	const named = NAMED[decoderFamily(source.platform)](source);
	return {
		key: s.key,
		source,
		sims: [...new Set([...s.sims, ...s.routes])].filter(identifies),
		display: s.display ?? named.display,
		iso: s.iso.length > 0 ? s.iso : named.iso,
	};
}

const sameSet = (x: readonly string[], y: readonly string[]): boolean =>
	JSON.stringify(x.toSorted()) === JSON.stringify(y.toSorted());

/** Whether linking must run again: the source is new, or what linking reads of it changed. */
export function identityChanged(before: SourceIdentity | undefined, after: SourceIdentity): boolean {
	return (
		before === undefined ||
		before.display !== after.display ||
		!sameSet(before.iso, after.iso) ||
		!sameSet(before.sims, after.sims) ||
		!sameSet(before.routes, after.routes)
	);
}

type Edge =
	| { readonly kind: "sims"; readonly between: readonly [SourceKey, SourceKey]; readonly shared: number }
	| { readonly kind: "manual"; readonly between: readonly [SourceKey, SourceKey] };

const pairKey = (a: string, b: string): string => (a < b ? `${a}\n${b}` : `${b}\n${a}`);

/** Union-find over source keys that never puts a pair kept apart into one group. */
class Groups {
	readonly #parent = new Map<string, string>();
	readonly #apart: ReadonlyArray<readonly [string, string]>;
	constructor(apart: ReadonlyArray<readonly [string, string]>) {
		this.#apart = apart;
	}
	find(k: string): string {
		let root = k;
		for (let up = this.#parent.get(root); up !== undefined && up !== root; up = this.#parent.get(root))
			root = up;
		this.#parent.set(k, root);
		return root;
	}
	/** Whether a and b are in one group afterwards. */
	join(a: string, b: string): boolean {
		const [ra, rb] = [this.find(a), this.find(b)];
		if (ra === rb) return true;
		const bridges = ([x, y]: readonly [string, string]): boolean => {
			const [rx, ry] = [this.find(x), this.find(y)];
			return (rx === ra && ry === rb) || (rx === rb && ry === ra);
		};
		if (this.#apart.some(bridges)) return false;
		const [child, root] = ra < rb ? [rb, ra] : [ra, rb];
		this.#parent.set(child, root);
		return true;
	}
}

/** Manual links first, then by shared keys: a split drops the weakest bridge. */
const strength = (e: Edge): number => (e.kind === "manual" ? Number.MAX_SAFE_INTEGER : e.shared);

/** How many keys each pair of sources on different platforms shares: one platform never links to itself. */
function sharedKeys(members: readonly Member[]): Map<SourceKey, Map<SourceKey, number>> {
	const owners = Map.groupBy(
		members.flatMap((m) => m.sims.map((k) => ({ k, m }))),
		(o) => o.k,
	);
	const shared = new Map<SourceKey, Map<SourceKey, number>>();
	for (const list of owners.values()) {
		for (const { m: a } of list) {
			for (const { m: b } of list) {
				if (a.source.platform === b.source.platform) continue;
				const row = shared.get(a.key) ?? new Map<SourceKey, number>();
				shared.set(a.key, row);
				row.set(b.key, (row.get(b.key) ?? 0) + 1);
			}
		}
	}
	return shared;
}

const platformOf = (k: SourceKey): Platform => sourceOf(k).platform;

/** On each other platform, the sources this one shares the most keys with (several on a tie). */
function best(row: ReadonlyMap<SourceKey, number> | undefined): Set<SourceKey> {
	const top = new Map<Platform, number>();
	for (const [k, n] of row ?? []) top.set(platformOf(k), Math.max(top.get(platformOf(k)) ?? 0, n));
	return new Set([...(row ?? [])].filter(([k, n]) => n > 0 && n === top.get(platformOf(k))).map(([k]) => k));
}

/**
 * Per other platform, the one best match when it is mutual or covers at least half of the chooser's rules. A tie links
 * nothing: rules several sources share (a host network's, a partner's) do not say which carrier a source is. Nor does a
 * match for under half of what either side shares with the other's platform: a Galaxy sales code that lists a host and
 * its MVNOs is none of them.
 */
function simEdges(members: readonly Member[]): Edge[] {
	const shared = sharedKeys(members);
	const bests = new Map(members.map((m) => [m.key, best(shared.get(m.key))]));
	const byKey = new Map(members.map((m) => [m.key, m]));
	// A source named only by its SIM rule is no operator to tell apart.
	const claimants = new Map<string, Set<Platform>>();
	for (const m of members.filter((x) => !isUnnamedRule(x.source, false)))
		for (const k of m.sims) claimants.set(k, (claimants.get(k) ?? new Set()).add(m.source.platform));
	/** How many of `m`'s rules named sources on `platform` claim. */
	const claimedOn = (m: Member, platform: Platform): number =>
		m.sims.filter((k) => claimants.get(k)?.has(platform) === true).length;
	/** Whether `m` is the one best match `t` has on m's platform; one among tied bests is not. */
	const onlyBest = (t: SourceKey, m: Member): boolean => {
		const back = [...(bests.get(t) ?? [])].filter((k) => platformOf(k) === m.source.platform);
		return back.length === 1 && back[0] === m.key;
	};
	const edges = new Map<string, Edge>();
	for (const m of members) {
		const byPlatform = Map.groupBy(bests.get(m.key) ?? [], platformOf);
		for (const candidates of byPlatform.values()) {
			const [t, ...tied] = candidates;
			const match = t === undefined ? undefined : byKey.get(t);
			if (match === undefined || tied.length > 0) continue;
			const n = shared.get(m.key)?.get(match.key) ?? 0;
			if (!onlyBest(match.key, m) && n * 2 < m.sims.length) continue;
			if (n * 2 < claimedOn(match, m.source.platform) || n * 2 < claimedOn(m, match.source.platform))
				continue;
			if (!edges.has(pairKey(m.key, match.key)))
				edges.set(pairKey(m.key, match.key), { kind: "sims", between: [m.key, match.key], shared: n });
		}
	}
	return [...edges.values()];
}

const platformRank = (m: Member): number => PLATFORMS.indexOf(m.source.platform);

/** By platform in PLATFORMS order (Apple's names are brands), then the most SIM rules: the first is who a carrier is named after. */
const byPrimacy = (x: Member, y: Member): number =>
	platformRank(x) - platformRank(y) || y.sims.length - x.sims.length || x.key.localeCompare(y.key);

/** The member a carrier is named after. */
const primary = (members: readonly Member[]): Member | undefined => members.toSorted(byPrimacy)[0];

/** A carrier's members as linking ranks them, so each platform's first is that platform's own primary. */
export const membersByPrimacy = (members: readonly SourceIdentity[]): SourceKey[] =>
	members
		.map(memberOf)
		.toSorted(byPrimacy)
		.map((m) => m.key);

function mostCommonIso(members: readonly Member[]): string | undefined {
	const counts = Map.groupBy(
		members.flatMap((m) => m.iso),
		(iso) => iso,
	);
	return [...counts].toSorted((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]))[0]?.[0];
}

/** An Apple bundle's iPhone, iPad and Watch files: one carrier's, by name. */
function namesakes(k: SourceKey): SourceKey[] {
	const s = sourceOf(k);
	if (decoderFamily(s.platform) !== "apple") return [k];
	return APPLE_PLATFORMS.map((platform) => sourceKey({ ...s, platform }));
}

/** Carriers from sources; country bundles are not carriers and are left out. */
function linkSources(members: readonly Member[], rules: readonly LinkRule[]): LinkedGroup[] {
	const known = new Set<SourceKey>(members.map((m) => m.key));
	const manual = rules.flatMap(({ a, b, rule }): Edge[] =>
		rule === "link" && known.has(a) && known.has(b) ? [{ kind: "manual", between: [a, b] }] : [],
	);
	const edges = [...simEdges(members.filter((m) => m.source.kind === "carrier")), ...manual].toSorted(
		(x, y) => strength(y) - strength(x) || pairKey(...x.between).localeCompare(pairKey(...y.between)),
	);
	const apart = rules.flatMap(({ a, b, rule }) =>
		rule === "split"
			? namesakes(a).flatMap((x) => namesakes(b).map((y): readonly [string, string] => [x, y]))
			: [],
	);
	const groups = new Groups(apart);
	for (const e of edges) groups.join(...e.between);

	const byRoot = Map.groupBy(
		members.filter((m) => m.source.kind !== "country"),
		(m) => groups.find(m.key),
	);
	return [...byRoot.values()].map((list): LinkedGroup => {
		const sorted = list.toSorted((x, y) => x.key.localeCompare(y.key));
		const head = primary(sorted);
		return {
			name: head?.display ?? sorted[0]?.source.name ?? "",
			iso: head?.iso[0] ?? mostCommonIso(sorted),
			members: sorted,
		};
	});
}

/** Members with the one the carrier is named after first. */
function primaryFirst(members: readonly Member[]): SourceRef[] {
	const p = primary(members);
	return (p === undefined ? members : [p, ...members.filter((m) => m !== p)]).map((m) => m.source);
}

/** Every source's carrier from every source's head identity, keeping each carrier's current id where it still names it. */
export function linkCarriers(
	heads: ReadonlyArray<SourceIdentity & { readonly carrier: string | null }>,
	rules: readonly LinkRule[],
): Linked {
	const current = Object.fromEntries(heads.flatMap((h) => (h.carrier === null ? [] : [[h.key, h.carrier]])));
	// Groups come in key order, so carriers of one size choose their ids in it.
	const members = heads.map(memberOf).toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	const withIds = assignIds(linkSources(members, rules), (g) => primaryFirst(g.members), current);
	return {
		carriers: withIds
			.map(({ carrier: g, id }): Carrier => ({
				id,
				name: g.members.some((m) => m.source.name === g.name) ? null : g.name,
				iso: g.iso ?? null,
			}))
			.toSorted((a, b) => a.id.localeCompare(b.id)),
		members: Object.fromEntries(withIds.flatMap(({ carrier: g, id }) => g.members.map((m) => [m.key, id]))),
	};
}
