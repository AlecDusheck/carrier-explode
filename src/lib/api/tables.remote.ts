/** Tables across sources: the SIM tables, releases, and the iOS modem packages. */

import * as v from "valibot";
import { query } from "$app/server";
import type { MccMncTable } from "#lib/decode/index.ts";
import * as apple from "#lib/server/apple.ts";
import * as baseband from "#lib/server/baseband.ts";
import * as releases from "#lib/server/releases.ts";
import { build, family, index, packageId, platform, release } from "./schemas";

export const getPlmn = query((): Promise<MccMncTable> => apple.plmnTable());
export const getManifestCounts = query((): Promise<Record<string, number>> => apple.manifestCounts());

export const getRelease = query(v.object({ platform, id: release }), (a): Promise<releases.ReleaseView> => releases.getRelease(a.platform, a.id));

export const getBasebandBuilds = query((): Promise<baseband.BuildFamilies[]> => baseband.basebandBuilds());
export const getModems = query(build, (b): Promise<baseband.BuildModems> => baseband.getModems(b));
export const getModemPackageHeader = query(packageId, (id): Promise<baseband.PackageHeader> => baseband.getModemPackageHeader(id));
export const getBaseband = query(v.object({ build, family }), (a): Promise<baseband.BasebandPage> => baseband.getBaseband(a.build, a.family));
export const getBasebandFile = query(v.object({ id: packageId, i: index }), (a): Promise<baseband.PackageFile> => baseband.getBasebandFile(a.id, a.i));
export const getBasebandCombos = query(v.object({ id: packageId, sha1: v.string(), tag: v.string() }), (a): Promise<string[]> =>
  baseband.getBasebandCombos(a.id, a.sha1, a.tag));
export const getBasebandDiff = query(v.object({ a: build, b: build, family }), (q): Promise<baseband.BasebandDiff> =>
  baseband.getBasebandDiff(q.a, q.b, q.family));
