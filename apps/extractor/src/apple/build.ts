/** An iOS build's IPSW outputs merged: each source's copies into one artifact, normalized, and the release record last. */

import * as v from "valibot";

import { compareProducts, unpackIpcc } from "@carrier-explode/decode-ios";
import type { AppleArtifact, AppleRelease, ImageModem, SourceKey } from "@carrier-explode/schema/types";
import { keys, parseRecord, putJson } from "@carrier-explode/storage";
import { allOrThrow, fanOut } from "../fan-out.ts";
import { normWriter, storeNormalized, type NormWriter } from "../normalize.ts";
import { iosReleaseMetadata, readBytes } from "../store.ts";
import type { UnitContext } from "../unit.ts";
import { ipswOutputSchema, mergeCopies, packBundle, type IpswOutput } from "./ipsw.ts";
import type { IosBuild } from "./plan.ts";

/** obj/<sha> and its Profile. A Profile is written after its artifact, so one already held means both are, and the bytes are not read. */
export async function storeBundle(
	w: NormWriter,
	source: SourceKey,
	sha: string,
	bytes: () => Promise<Uint8Array>,
): Promise<void> {
	if ((await w.bucket.head(keys.norm(sha))) !== null) return;
	await storeNormalized(w, { kind: "apple.ipcc", sha, source }, await bytes());
}

/** R2 calls in flight. */
const CONCURRENCY = 8;

type Copy = IpswOutput["bundles"][number];

/** One artifact per source: a copy every IPSW agrees on as it is, else the copies merged and packed again. */
async function storeSource(
	u: UnitContext,
	w: NormWriter,
	source: SourceKey<"ios">,
	copies: readonly Copy[],
): Promise<AppleArtifact> {
	const copy = (sha: string): Promise<Uint8Array> => readBytes(u.bucket, keys.tmp(u.instance, sha));
	const distinct = [...new Map(copies.map((c) => [c.sha, c])).values()];
	const [only, ...more] = distinct;
	if (only === undefined) throw new Error(`${source}: no copies`);
	if (more.length === 0) {
		const { sha, version, size, cid } = only;
		await storeBundle(w, source, sha, () => copy(sha));
		return { sha, version, size, cid };
	}
	const merged = await packBundle(
		await mergeCopies(distinct.map((c) => async () => unpackIpcc(await copy(c.sha)))),
	);
	await storeBundle(w, source, merged.artifact.sha, () => Promise.resolve(merged.bytes));
	return merged.artifact;
}

/** One entry per package: the IPSWs that carry the same bytes name their own phones. */
function mergeModems(parts: readonly IpswOutput[]): ImageModem[] {
	const out = new Map<string, ImageModem>();
	for (const m of parts.flatMap((p) => p.modems)) {
		const held = out.get(m.package.sha);
		out.set(
			m.package.sha,
			held === undefined
				? m
				: { ...held, devices: [...new Set([...held.devices, ...m.devices])].toSorted(compareProducts) },
		);
	}
	return [...out.values()].toSorted((a, b) => a.package.name.localeCompare(b.package.name));
}

/** The IPSW jobs' outputs (JSON text, in `build.ipsws` order) merged and normalized to norm/; releases/ios/<build>.json written last. */
export async function merge(build: IosBuild, outputs: readonly string[], u: UnitContext): Promise<void> {
	const parts = outputs.map((o) => v.parse(ipswOutputSchema, parseRecord(`${build.build} IPSW output`, o)));
	const bySource = Map.groupBy(
		parts.flatMap((p) => p.bundles),
		(c) => c.source,
	);
	const w = normWriter(u.bucket);
	const stored = allOrThrow(
		"bundles",
		await fanOut(
			[...bySource].toSorted(([a], [b]) => a.localeCompare(b)),
			CONCURRENCY,
			async ([source, copies]) => [source, await storeSource(u, w, source, copies)] as const,
		),
	);
	const release: AppleRelease = {
		platform: "ios",
		id: build.build,
		version: build.version,
		label: build.label,
		prerelease: build.prerelease,
		...(build.released === undefined ? {} : { released: build.released }),
		devices: [...new Set(parts.flatMap((p) => p.devices))].toSorted(compareProducts),
		extractedAt: new Date().toISOString(),
		sources: Object.fromEntries(stored),
		modems: mergeModems(parts),
	};
	// Last: the build is held once its record is listed.
	await putJson(u.bucket, keys.release("ios", build.build), release, iosReleaseMetadata(release.devices));
}
