/** Builds of every platform: the list, one build's changes, the modems it ships, and carriers' newest changes. */

import * as v from "valibot";
import { query } from "$app/server";
import { feedKeySchema } from "@carrier-explode/db";
import { RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
import * as builds from "#lib/server/builds.ts";
import * as recent from "#lib/server/recent.ts";
import { deviceNames } from "#lib/server/catalog.ts";
import * as releases from "#lib/server/releases.ts";
import { iso, release } from "./schemas";

const build = v.object({ platform: v.picklist(RELEASE_PLATFORMS), build: release });

/** Every build held, newest first. */
export const getBuilds = query(builds.getBuilds);
/** A build: the sources it added, removed and changed. */
export const getRelease = query(build, (a) => releases.getRelease(a.platform, a.build));
export const getBuildModems = query(build, (a) => builds.getBuildModems(a.platform, a.build));
/** How many carriers of its platform's list each of its builds ships, as [build, count] pairs. */
export const getCarriersShipped = query(v.picklist(RELEASE_PLATFORMS), releases.carriersShipped);
/** The sources a build ships. */
export const getShipped = query(build, (a) => releases.getShipped(a.platform, a.build));
/** A platform's phone names, as [code, name] pairs. */
export const getPhoneNames = query(v.picklist(RELEASE_PLATFORMS), async (platform) => [
	...(await deviceNames(platform)),
]);
/** A page of the newest changes to carriers in a country (null: the fallback country) on a platform (null: every one), after a feed key. */
export const getRecentChanges = query(
	v.object({
		iso: v.nullable(iso),
		platform: v.nullable(v.picklist(RELEASE_PLATFORMS)),
		after: v.nullable(feedKeySchema),
	}),
	(a) => recent.getRecentChanges({ iso: a.iso ?? recent.FALLBACK_ISO, platform: a.platform }, a.after),
);
