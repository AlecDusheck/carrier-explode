/** Builds of every platform: the list, one build's changes, and the modems it ships. */

import * as v from "valibot";
import { query } from "$app/server";
import { RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
import * as builds from "#lib/server/builds.ts";
import { deviceNames } from "#lib/server/catalog.ts";
import * as releases from "#lib/server/releases.ts";
import { release } from "./schemas";

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
