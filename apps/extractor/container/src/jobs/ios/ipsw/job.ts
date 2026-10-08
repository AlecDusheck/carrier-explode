/**
 * ios.ipsw: one IPSW, opened once. Its modem packages to obj/ with their summaries; its root filesystem to disk, the
 * carrier and country bundle directories copied out, and each bundle packed to tmp/<instance>/<sha> for the merge step.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

import * as v from "valibot";

import { sourceKey } from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import { allOrThrow, fanOut } from "../../../../../src/fan-out.ts";
import { ipswParamsSchema, packBundle, type IpswOutput } from "../../../../../src/apple/ipsw.ts";
import { DataError } from "../../../../../src/errors.ts";
import type { JobContext, JobRunner } from "../../../job.ts";
import { openIpsw } from "../remote-ipsw.ts";
import { BUNDLE_DIRS, listBundles, readBundle, type BundleDir, type BundleKind } from "./bundles.ts";
import { extractBundleDirs } from "./extract.ts";
import { downloadOsImage } from "./image.ts";
import { storeModems } from "./modems.ts";

const KINDS = ["carrier", "country"] as const satisfies readonly BundleKind[];

type Copy = IpswOutput["bundles"][number];

async function stageAll(
	ctx: JobContext,
	instance: string,
	kind: BundleKind,
	dirs: readonly BundleDir[],
	concurrency: number,
): Promise<Copy[]> {
	return allOrThrow(
		`${kind} bundles`,
		await fanOut(dirs, concurrency, async (dir): Promise<Copy> => {
			const { bytes, artifact } = await packBundle(await readBundle(dir));
			await ctx.bucket.putOnce(keys.tmp(instance, artifact.sha), bytes, "application/zip");
			return { source: sourceKey({ platform: "ios", kind, name: dir.name }), ...artifact };
		}),
	);
}

export const iosIpsw: JobRunner = async (params, ctx): Promise<IpswOutput> => {
	const { build, url, instance, concurrency } = v.parse(ipswParamsSchema, params);
	ctx.log(`${build} ${url}`);
	const ipsw = await openIpsw(url);
	if (ipsw.manifest.build !== build)
		throw new DataError(`${url} is build ${ipsw.manifest.build}, not ${build}`);

	const modems = await storeModems(ipsw, ctx);

	const image = await downloadOsImage(ipsw.zip, url, ipsw.manifest, ctx.tmp, ctx.log);
	const dirs = await extractBundleDirs(image, join(ctx.tmp, "bundles"));
	await rm(image);
	const bundles: Copy[] = [];
	for (const kind of KINDS) {
		const found = await listBundles(dirs[kind]);
		if (found.length === 0) throw new DataError(`${BUNDLE_DIRS[kind]} is empty in ${url}`);
		bundles.push(...(await stageAll(ctx, instance, kind, found, concurrency)));
		ctx.log(`${kind}: ${found.length} bundles`);
	}
	return { devices: [...ipsw.manifest.devices], bundles, modems };
};
