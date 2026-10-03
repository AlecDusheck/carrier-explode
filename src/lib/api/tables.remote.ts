/** Tables across pages: the SIM tables, the scan index, builds, and the iOS modem packages. */

import * as v from "valibot";
import { query } from "$app/server";
import type { MccMncTable } from "#lib/decode/index.ts";
import type { ReleaseSummary } from "#lib/storage/keys.ts";
import { plmnTable } from "#lib/server/apple.ts";
import * as baseband from "#lib/server/baseband.ts";
import * as ios from "#lib/server/ios.ts";
import type { ScanResult, SettingSummary } from "#lib/server/keyscan.ts";
import * as releases from "#lib/server/releases.ts";
import * as scan from "#lib/server/scan.ts";
import { build, device, family, index, packageId, path, platform, release, ver } from "./schemas";

export const getPlmn = query((): Promise<MccMncTable> => plmnTable());

const oneCountry = v.custom<`country:${string}`>((s) => typeof s === "string" && /^country:[a-z]{2}$/.test(s), "not a country scope");
const scanArgs = v.object({ platform, path, file: path, scope: v.union([v.picklist(["carriers", "countries"]), oneCountry]) });

/** One setting across every source in scope. */
export const scanKey = query(scanArgs, (a): Promise<ScanResult> => scan.scanKey(a.platform, a.path, a.file, a.scope));
/** A scan cut to a few numbers, the same for everybody: wiki pages show several at once. */
export const getSettingSummary = query(scanArgs, (a): Promise<SettingSummary> => scan.settingSummary(a.platform, a.path, a.file, a.scope));

/** A build of either platform: the sources it added, removed and changed. */
export const getRelease = query(v.object({ platform, id: release }), (a): Promise<releases.ReleaseView> => releases.getRelease(a.platform, a.id));
export const getAndroidBuilds = query((): Promise<ReleaseSummary[]> => releases.releasesOf("android"));

export const getBasebandBuilds = query((): Promise<baseband.BuildFamilies[]> => baseband.basebandBuilds());
export const getModems = query(build, (b): Promise<baseband.BuildModems> => baseband.getModems(b));
export const getModemPackageHeader = query(packageId, (id): Promise<baseband.PackageHeader> => baseband.getModemPackageHeader(id));
export const getBaseband = query(v.object({ build, family }), (a): Promise<baseband.BasebandPage> => baseband.getBaseband(a.build, a.family));
export const getBasebandFile = query(v.object({ id: packageId, i: index }), (a): Promise<baseband.PackageFile> => baseband.getBasebandFile(a.id, a.i));
export const getBasebandCombos = query(v.object({ id: packageId, sha1: v.string(), tag: v.string() }), (a): Promise<string[]> =>
  baseband.getBasebandCombos(a.id, a.sha1, a.tag));
export const getBasebandDiff = query(v.object({ a: build, b: build, family }), (q): Promise<baseband.BasebandDiff> =>
  baseband.getBasebandDiff(q.a, q.b, q.family));

/** An Apple version's modem override files, with the phones that read each. */
export const getBundleOverrides = query(v.object(ver), (a): Promise<ios.BundleOverrides | null> => ios.getBundleOverrides(a));
export const getBasebandDefaults = query(v.object({ ...ver, device: v.exactOptional(device) }), (a): Promise<ios.ModemDefaults> =>
  ios.getBasebandDefaults(a, a.device));
export const getBasebandOverride = query(v.object({ ...ver, id: packageId, pri: path, efs: path, i: index }), (a): Promise<ios.ModemOverride> =>
  ios.getBasebandOverride(a, a.id, a.pri, a.efs, a.i));
