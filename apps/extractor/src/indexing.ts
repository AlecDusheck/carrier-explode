/**
 * Indexing: make D1 reflect a unit's R2 records, writing only rows that differ. A message too big for one invocation's
 * D1 queries hands the rest on as the next message.
 */

import * as v from "valibot";

import {
	copiesOf,
	countFacts,
	deviceList,
	lastFacts,
	headIdentities,
	heldRelease,
	linkRules,
	boardRadiosOf,
	configRadiosOf,
	missingProfiles,
	neighbours,
	newestReleaseDevices,
	putOtaFile,
	putProfiles,
	putRelease,
	putBaseRows,
	putSource,
	releasedDevices,
	releaseIds,
	selectedBy,
	setHas5g,
	shippedIn,
	shippedSourceCount,
	sourceKeys,
	sourceOf,
	syncChanges,
	syncCopies,
	syncEntries,
	syncPhoneStates,
	syncHeadRows,
	syncRoutes,
	writeLinked,
	type IndexDb,
	type ShownDevice,
} from "@carrier-explode/db";
import { decodeCarrierList } from "@carrier-explode/decode-android";
import { parseManifest } from "@carrier-explode/decode-ios";
import {
	baseSource,
	carrierListRoutes,
	configRadio,
	has5g,
	head,
	headRows,
	identityChanged,
	lastChanged,
	layeredRadio,
	linkCarriers,
	manifestRoutes,
	modemFacts,
	newestFirst,
	phoneHeads,
	sourceBase,
	phoneRadio,
	phoneStates,
	profileFacts,
	releaseChanges,
	sourceTimeline,
	type ConfigRadio,
	type DeviceOrder,
	type Phone,
	type ProfileFacts,
	type SourceCopy,
	type SourceIdentity,
} from "@carrier-explode/schema";
import {
	APPLE_PLATFORMS,
	decoderFamily,
	isReleasePlatform,
	parseSourceKey,
	PLATFORMS,
	RELEASE_PLATFORMS,
	ruleKey,
	type DecoderFamily,
	type Platform,
	type Release,
	type ReleasePlatform,
	type SimRule,
	type SourceKey,
	type SourceRef,
} from "@carrier-explode/schema/types";
import {
	modemFactsSchema,
	profileFactsSchema,
	profileSchema,
	sha1Schema,
	sourceKeySchema,
} from "@carrier-explode/schema/records";
import { keys, OTA_FEEDS, parseRecord, type OtaFeed, type ReleaseKey } from "@carrier-explode/storage";
import { releaseTargetSchema } from "./pipelines.ts";
import { FEED_PLATFORM, heldRecords, recordTarget } from "./reindex.ts";
import {
	otaFacts,
	partDevice,
	readRelease,
	releaseFacts,
	withPart,
	type NormRef,
	type OtaFacts,
	type ReleaseFacts,
} from "./records.ts";

/** OTA file URLs one message indexes: each costs about eleven D1 queries, and an invocation may make 1,000. */
const OTA_PER_MESSAGE = 50;

/**
 * What the index queue carries: a unit's release record or OTA files, whose facts are written; `settle`, sent
 * SETTLE_DELAY_S after facts, carrying their number; the routes of Apple's manifest; `rederive`, a platform derived
 * again; `reindex`, a platform's held records' facts, one record a message, the one heldRecords lists after `after`,
 * then its rederive; and `derive`, a rederive's sources, DERIVED_PER_MESSAGE at a time, then its releases' changes,
 * CHANGES_PER_MESSAGE at a time.
 */
export const indexMessageSchema = v.variant("kind", [
	releaseTargetSchema,
	v.object({
		kind: v.literal("ota"),
		feed: v.picklist(OTA_FEEDS),
		urls: v.pipe(v.array(v.pipe(v.string(), v.url())), v.minLength(1), v.maxLength(OTA_PER_MESSAGE)),
	}),
	v.object({
		kind: v.literal("settle"),
		platform: v.picklist(RELEASE_PLATFORMS),
		facts: v.pipe(v.number(), v.integer(), v.minValue(1)),
	}),
	v.object({ kind: v.literal("routes"), manifest: sha1Schema }),
	v.object({ kind: v.literal("rederive"), platform: v.picklist(RELEASE_PLATFORMS) }),
	v.object({
		kind: v.literal("reindex"),
		platform: v.picklist(RELEASE_PLATFORMS),
		after: v.nullable(v.pipe(v.string(), v.minLength(1))),
	}),
	v.object({
		kind: v.literal("derive"),
		sources: v.array(sourceKeySchema),
		changes: v.array(
			v.object({ platform: v.picklist(RELEASE_PLATFORMS), id: v.pipe(v.string(), v.minLength(1)) }),
		),
	}),
]);
export type IndexMessage = v.InferOutput<typeof indexMessageSchema>;

/** An OTA unit's files, as the messages that index them. */
export function otaMessages(feed: OtaFeed, urls: readonly string[]): IndexMessage[] {
	return Array.from({ length: Math.ceil(urls.length / OTA_PER_MESSAGE) }, (_, i) => ({
		kind: "ota",
		feed,
		urls: urls.slice(i * OTA_PER_MESSAGE, (i + 1) * OTA_PER_MESSAGE),
	}));
}

/**
 * A platform is derived once its facts stop arriving for this long: a backfill's iOS builds end at most a build (about
 * 40 minutes) apart while the 20-minute check keeps containers busy, so a backfill derives once, at its end.
 */
const SETTLE_DELAY_S = 3600;

/** How long the queue holds a message before it is delivered. */
export const delayOf = (m: IndexMessage): number => (m.kind === "settle" ? SETTLE_DELAY_S : 0);

/** Sources one derive message derives: each costs up to nineteen D1 queries (twelve when nothing changed), a Pixel source one more for its default.pb's leaves. */
const DERIVED_PER_MESSAGE = 25;

/** Releases whose changes one derive message derives, once its sources are done: one and linking cost about ten D1 queries. */
const CHANGES_PER_MESSAGE = 25;

/** Normalized bytes one message reads for new profile rows: a Pixel firmware's modem configurations are ~270 of ~4 MB. */
const NORM_BYTES_PER_MESSAGE = 96_000_000;

/** Profile rows written at once. */
const PROFILES_AT_ONCE = 25;

/** Whether D1 changed, so the readers purge, and the message that carries on the work, if any. */
export interface Indexed {
	readonly wrote: boolean;
	readonly next: IndexMessage | null;
}

export interface IndexContext {
	readonly db: IndexDb;
	readonly bucket: R2Bucket;
}

/** Each family's devices are listed under one release platform. */
const DEVICE_PLATFORM = { apple: "ios", android: "android", samsung: "samsung" } as const satisfies Record<
	DecoderFamily,
	ReleasePlatform
>;

/** What one indexing reads more than once, read once. */
class Reads {
	readonly #devices = new Map<ReleasePlatform, Promise<ShownDevice[]>>();
	readonly #phones = new Map<ReleasePlatform, Promise<Phone[]>>();
	readonly #bases = new Map<SourceKey, Promise<SourceCopy[]>>();

	constructor(readonly ctx: IndexContext) {}

	devices(platform: ReleasePlatform): Promise<ShownDevice[]> {
		const known = this.#devices.get(platform) ?? deviceList(this.ctx.db, platform);
		this.#devices.set(platform, known);
		return known;
	}

	async order(platform: ReleasePlatform): Promise<DeviceOrder> {
		return newestFirst(await this.devices(platform));
	}

	/** The copies of the source a platform's carrier files are read over, once its unit's copies are synced; none without one. */
	async baseCopies(platform: Platform): Promise<SourceCopy[]> {
		const key = baseSource(platform);
		if (key === null) return [];
		const known = this.#bases.get(key) ?? copiesOf(this.ctx.db, key, platform);
		this.#bases.set(key, known);
		return known;
	}

	/** The phones some indexed release lists, which phone states are derived for: scope only filters what is ingested. */
	phones(platform: ReleasePlatform): Promise<Phone[]> {
		const known =
			this.#phones.get(platform) ??
			releasedDevices(this.ctx.db, platform).then((ds) =>
				ds.map((d) => ({ code: d.code, boards: d.boards, has5g: d.has5g })),
			);
		this.#phones.set(platform, known);
		return known;
	}
}

function refOf(key: SourceKey): SourceRef {
	const ref = parseSourceKey(key);
	if (ref === undefined) throw new Error(`${key}: not a source key`);
	return ref;
}

async function readObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody> {
	const o = await bucket.get(key);
	if (o === null) throw new Error(`${key}: missing; its unit writes it before its record`);
	return o;
}

const readNorm = async (bucket: R2Bucket, sha: string): Promise<unknown> =>
	parseRecord(keys.norm(sha), await (await readObject(bucket, keys.norm(sha))).text());

/** Whether a message wrote to D1, and whether it wrote all of its unit's facts or left the rest to the next. */
interface FactsWritten {
	readonly wrote: boolean;
	readonly done: boolean;
}

/**
 * Content rows for the shas the index has none for (or stale ones), read one at a time until NORM_BYTES_PER_MESSAGE
 * are read; done once every sha has its rows.
 */
async function putNew(ctx: IndexContext, norm: readonly NormRef[]): Promise<FactsWritten> {
	const missing = new Set(
		await missingProfiles(
			ctx.db,
			norm.map((n) => n.sha),
		),
	);
	const wanted = [...new Map(norm.filter((n) => missing.has(n.sha)).map((n) => [n.sha, n])).values()];
	const baseRadio = configRadios(ctx.bucket);
	const facts: ProfileFacts[] = [];
	let read = 0;
	let put = 0;
	for (const n of wanted) {
		if (read >= NORM_BYTES_PER_MESSAGE) break;
		const o = await readObject(ctx.bucket, keys.norm(n.sha));
		read += o.size;
		const json = parseRecord(keys.norm(n.sha), await o.text());
		if (n.kind === "profile") facts.push(profileFacts(v.parse(profileFactsSchema, json)));
		else {
			const config = v.parse(modemFactsSchema, json);
			facts.push(modemFacts(config, config.base === null ? null : await baseRadio(config.base)));
		}
		put++;
		if (facts.length === PROFILES_AT_ONCE) await putProfiles(ctx.db, facts.splice(0));
	}
	if (facts.length > 0) await putProfiles(ctx.db, facts);
	return { wrote: put > 0, done: put === wanted.length };
}

/** What linking reads of a source now; undefined before it has a head. */
async function identityOf(db: IndexDb, key: SourceKey): Promise<SourceIdentity | undefined> {
	const s = await sourceOf(db, key);
	if (s === undefined) return undefined;
	const { claimed, routed } = await selectedBy(db, s.headSha, key);
	return { key, display: s.display, iso: s.iso, sims: claimed, routes: routed };
}

/** A touched source's timeline, head and phone states. Returns whether it wrote, and whether linking must run. */
async function deriveSource(
	reads: Reads,
	key: SourceKey,
): Promise<{ readonly wrote: boolean; readonly relink: boolean }> {
	const { db, bucket } = reads.ctx;
	const ref = refOf(key);
	const before = await identityOf(db, key);
	const copies = await copiesOf(db, key, ref.platform);
	const order = await reads.order(DEVICE_PLATFORM[decoderFamily(ref.platform)]);
	const timeline = sourceTimeline(copies);
	const at = head(ref, timeline, order);
	if (at === undefined) throw new Error(`${key}: no copy left to head it`);

	const entriesChanged = await syncEntries(db, key, timeline);
	// iPad and Watch bundles are no phone's.
	const phones = isReleasePlatform(ref.platform) ? await reads.phones(ref.platform) : [];
	const base = phones.length > 0 ? await reads.baseCopies(ref.platform) : [];
	const heads = phoneHeads(
		{ source: ref, copies, timeline, order, base },
		phones.map((p) => p.code),
	);
	const shas = new Set([...heads.values()].flatMap((h) => (h.base === null ? [h.sha] : [h.sha, h.base])));
	const profiles = new Map(
		await Promise.all(
			[...shas].map(async (sha) => [sha, v.parse(profileSchema, await readNorm(bucket, sha))] as const),
		),
	);
	const baseSha = sourceBase(heads, order);
	const baseChanged =
		baseSha !== null &&
		(await putBaseRows(
			db,
			baseSha,
			headRows(profiles.get(baseSha) ?? v.parse(profileSchema, await readNorm(bucket, baseSha))).settings,
		));
	const sourceChanged = await putSource(db, {
		key,
		platform: ref.platform,
		kind: ref.kind,
		name: ref.name,
		headSha: at.sha,
		baseSha,
		updated: lastChanged(timeline),
	});
	const statesChanged = await syncPhoneStates(
		db,
		key,
		phoneStates(heads, (sha) => profiles.get(sha), phones),
	);
	const headProfile = profiles.get(at.sha) ?? v.parse(profileSchema, await readNorm(bucket, at.sha));
	const rowsChanged = await syncHeadRows(db, key, headRows(headProfile));

	const after = await identityOf(db, key);
	if (after === undefined) throw new Error(`${key}: its head ${at.sha} has no profile row`);
	return {
		wrote: entriesChanged || baseChanged || sourceChanged || statesChanged || rowsChanged,
		relink: identityChanged(before, after),
	};
}

/** A modem configuration's radio, its base layers included, each configuration read once. */
function configRadios(bucket: R2Bucket): (sha: string) => Promise<ConfigRadio> {
	const known = new Map<string, Promise<ConfigRadio>>();
	const radioOf = (sha: string): Promise<ConfigRadio> => {
		const read =
			known.get(sha) ??
			readNorm(bucket, sha).then(async (json) => {
				const config = v.parse(modemFactsSchema, json);
				return layeredRadio(configRadio(config), config.base === null ? null : await radioOf(config.base));
			});
		known.set(sha, read);
		return read;
	};
	return radioOf;
}

/** Whether each of `devices` has 5G, as the release's profile rows say: an iPhone's override plists, another phone's modem configurations. */
async function releaseRadios(
	reads: Reads,
	release: Release,
	facts: ReleaseFacts,
	devices: readonly string[],
): Promise<Map<string, boolean | null>> {
	const { db } = reads.ctx;
	if (release.platform === "ios") {
		const bundles = await boardRadiosOf(
			db,
			facts.norm.map((n) => n.sha),
		);
		const phones = (await reads.devices(release.platform)).filter((d) => devices.includes(d.code));
		return new Map(phones.map((p) => [p.code, has5g([phoneRadio(bundles, p)])]));
	}
	return new Map(
		await Promise.all(
			devices.map(async (device) => {
				const shas = facts.rows.configs.flatMap((c) => (c.device === device ? [c.sha] : []));
				return [device, has5g(await configRadiosOf(db, shas))] as const;
			}),
		),
	);
}

/** 5G for each of the record's devices its release is the newest of. Returns whether any device's changed. */
async function judgeRadios(reads: Reads, release: Release, facts: ReleaseFacts): Promise<boolean> {
	const { db } = reads.ctx;
	const newest = (await newestReleaseDevices(db, release.platform, release.id)).filter((d) =>
		release.devices.includes(d),
	);
	if (newest.length === 0) return false;
	const radios = await releaseRadios(reads, release, facts, newest);
	const written = await Promise.all([...radios].map(([code, fiveG]) => setHas5g(db, code, fiveG)));
	return written.some(Boolean);
}

/** A release's changes, and those of the release after it, which a backfilled release now precedes. */
async function deriveChanges(reads: Reads, platform: ReleasePlatform, id: string): Promise<boolean> {
	const { db } = reads.ctx;
	const order = await reads.order(platform);
	const { previous, next } = await neighbours(db, platform, id);
	const now = await shippedIn(db, platform, id);
	const own = await syncChanges(
		db,
		platform,
		id,
		releaseChanges(previous === null ? null : await shippedIn(db, platform, previous), now, order),
	);
	const after =
		next !== null &&
		(await syncChanges(db, platform, next, releaseChanges(now, await shippedIn(db, platform, next), order)));
	return own || after;
}

async function link(db: IndexDb): Promise<boolean> {
	const [heads, rules] = await Promise.all([headIdentities(db), linkRules(db)]);
	return (await writeLinked(db, linkCarriers(heads, rules))).length > 0;
}

/** A routing table's SIM rules as ruleKeys. */
const matchers = (routed: Readonly<Record<SourceKey, readonly SimRule[]>>): Record<SourceKey, string[]> =>
	Object.fromEntries(Object.entries(routed).map(([key, rules]) => [key, rules.map(ruleKey)]));

/**
 * Derives the first DERIVED_PER_MESSAGE of a derive message's sources, linking when an identity changed; the rest follow,
 * then the releases' changes. The chain's last message links too, so a change to linking or its rules lands with a
 * reindex.
 */
async function indexDerive(
	reads: Reads,
	m: Extract<IndexMessage, { readonly kind: "derive" }>,
): Promise<Indexed> {
	const { db } = reads.ctx;
	const now = m.sources.slice(0, DERIVED_PER_MESSAGE);
	const rest = m.sources.slice(DERIVED_PER_MESSAGE);
	let wrote = false;
	let relink = false;
	for (const key of now) {
		const d = await deriveSource(reads, key);
		wrote ||= d.wrote;
		relink ||= d.relink;
	}
	const releases = rest.length === 0 ? m.changes.slice(0, CHANGES_PER_MESSAGE) : [];
	const later = m.changes.slice(releases.length);
	const last = rest.length === 0 && later.length === 0;
	for (const r of releases) wrote = (await deriveChanges(reads, r.platform, r.id)) || wrote;
	const linked = (relink || (last && m.changes.length > 0)) && (await link(db));
	return {
		wrote: wrote || linked,
		next: rest.length > 0 ? { ...m, sources: rest } : last ? null : { ...m, sources: [], changes: later },
	};
}

/** Each family's release platform's devices order and match the sources of every platform of that family. */
const familyPlatforms = (platform: ReleasePlatform): Platform[] =>
	PLATFORMS.filter((p) => DEVICE_PLATFORM[decoderFamily(p)] === platform);

/** A platform derived again, every source and change of it: what its facts and devices (their order moves heads, their boards phone states) say now. */
async function indexRederive(reads: Reads, platform: ReleasePlatform): Promise<Indexed> {
	const { db } = reads.ctx;
	const [sources, ids] = await Promise.all([
		sourceKeys(db, familyPlatforms(platform)),
		releaseIds(db, platform),
	]);
	return {
		wrote: false,
		next: { kind: "derive", sources, changes: ids.map((id) => ({ platform, id })) },
	};
}

/**
 * The newest Pixel build's carrier list, as its newest indexed device's record names it, is Android's routing: the SIM
 * rules it sends each carrier source. Returns the sources rerouted.
 */
async function routePixels(
	ctx: IndexContext,
	release: Release,
	buildDevices: readonly string[],
): Promise<SourceKey[]> {
	if (
		release.platform !== "android" ||
		buildDevices[0] !== release.devices[0] ||
		(await neighbours(ctx.db, "android", release.id)).next !== null
	)
		return [];
	const list = await readObject(ctx.bucket, keys.obj(release.carrierList));
	return syncRoutes(
		ctx.db,
		["android"],
		matchers(carrierListRoutes(decodeCarrierList(new Uint8Array(await list.arrayBuffer())))),
	);
}

/** One release record's facts: its copies, then its release's rows with it (a Pixel's record joining its build's other devices' rows). */
async function releaseRows(reads: Reads, key: ReleaseKey): Promise<FactsWritten> {
	const { db, bucket } = reads.ctx;
	const release = await readRelease(bucket, key);
	const order = await reads.order(key.platform);
	const facts = releaseFacts(release, order);
	const profiles = await putNew(reads.ctx, facts.norm);
	if (!profiles.done) return profiles;
	const touched = await syncCopies(db, facts.holding);
	const device = partDevice(key);
	const rows =
		device === null
			? facts.rows
			: withPart(await heldRelease(db, key.platform, release.id), facts.rows, device, order);
	const sourceCount = await shippedSourceCount(db, key.platform, release.id);
	const releaseChanged = await putRelease(db, { ...rows.release, sourceCount }, rows.modems, rows.configs);
	const radiosChanged = await judgeRadios(reads, release, facts);
	const rerouted = await routePixels(reads.ctx, release, rows.release.devices);
	const linked = rerouted.length > 0 && (await link(db));
	return {
		wrote:
			touched.length > 0 ||
			releaseChanged ||
			profiles.wrote ||
			radiosChanged ||
			rerouted.length > 0 ||
			linked,
		done: true,
	};
}

/** OTA files' facts: their profiles' rows, then each file's row and copies. */
async function otaRows(reads: Reads, feed: OtaFeed, urls: readonly string[]): Promise<FactsWritten> {
	const { db, bucket } = reads.ctx;
	const files: OtaFacts[] = [];
	for (const url of urls) files.push(await otaFacts(bucket, feed, url));
	const profiles = await putNew(
		reads.ctx,
		files.flatMap((f) => f.norm),
	);
	if (!profiles.done) return profiles;
	let wrote = profiles.wrote;
	for (const facts of files) {
		wrote = (await putOtaFile(db, facts.file)) || wrote;
		wrote = (await syncCopies(db, facts.holding)).length > 0 || wrote;
	}
	return { wrote, done: true };
}

/**
 * The platform's next held record after `after`, its facts written; the next message takes the one after it. The
 * last derives the platform again, once every record's facts are written: a source's head and its phones' states read
 * every copy of it. Each counts as a facts message, so no settle message derives the platform before the last.
 */
async function indexHeld(
	reads: Reads,
	m: Extract<IndexMessage, { readonly kind: "reindex" }>,
): Promise<Indexed> {
	const { bucket } = reads.ctx;
	const { value: record } = await heldRecords(bucket, m.platform, m.after).next();
	if (record === undefined) return { wrote: false, next: { kind: "rederive", platform: m.platform } };
	await countFacts(reads.ctx.db, m.platform);
	const target = await recordTarget(bucket, record);
	const { wrote, done } =
		target.kind === "release"
			? await releaseRows(reads, target.release)
			: await otaRows(reads, target.feed, [target.url]);
	return { wrote, next: done ? { ...m, after: record } : m };
}

/** Apple's OTA manifest is Apple's routing: the SIM rules it sends each carrier source of iOS, iPadOS and watchOS. */
async function indexRoutes(reads: Reads, manifest: string): Promise<Indexed> {
	const { db, bucket } = reads.ctx;
	const o = await readObject(bucket, keys.appleOtaManifest(manifest));
	const rerouted = await syncRoutes(
		db,
		APPLE_PLATFORMS,
		matchers(manifestRoutes(parseManifest(new Uint8Array(await o.arrayBuffer())))),
	);
	const linked = rerouted.length > 0 && (await link(db));
	return { wrote: rerouted.length > 0 || linked, next: null };
}

/**
 * A unit's facts, written; its platform is derived once facts stop arriving, in a settle message sent after a delay.
 * A message that wrote only some carries on as itself.
 */
async function indexFacts(
	reads: Reads,
	m: IndexMessage,
	platform: ReleasePlatform,
	{ wrote, done }: FactsWritten,
): Promise<Indexed> {
	if (!done) return { wrote, next: m };
	const facts = await countFacts(reads.ctx.db, platform);
	return { wrote, next: { kind: "settle", platform, facts } };
}

/** A settle message: its platform derived again if no facts came after its own; a later settle message covers them otherwise. */
async function indexSettle(
	reads: Reads,
	m: Extract<IndexMessage, { readonly kind: "settle" }>,
): Promise<Indexed> {
	const last = await lastFacts(reads.ctx.db, m.platform);
	return { wrote: false, next: last === m.facts ? { kind: "rederive", platform: m.platform } : null };
}

/** One message's share of the index. */
export async function indexUnit(ctx: IndexContext, m: IndexMessage): Promise<Indexed> {
	const reads = new Reads(ctx);
	switch (m.kind) {
		case "release":
			return indexFacts(reads, m, m.release.platform, await releaseRows(reads, m.release));
		case "ota":
			return indexFacts(reads, m, FEED_PLATFORM[m.feed], await otaRows(reads, m.feed, m.urls));
		case "settle":
			return indexSettle(reads, m);
		case "routes":
			return indexRoutes(reads, m.manifest);
		case "derive":
			return indexDerive(reads, m);
		case "rederive":
			return indexRederive(reads, m.platform);
		case "reindex":
			return indexHeld(reads, m);
	}
}
