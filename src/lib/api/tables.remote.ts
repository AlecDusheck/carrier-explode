import * as v from "valibot";
import { query } from "$app/server";
import * as data from "$lib/server/data";
import { build, bundle, device, family, index, packageId } from "./schemas";

export const getCbs = query(() => data.getCbs());
export const getPlmn = query(() => data.getPlmn());

export const scanKey = query(v.object({ path: v.string(), file: v.string(), scope: v.string() }), (a) =>
  data.scanKey(a.path, a.file, a.scope));

export const getBasebandBuilds = query(() => data.basebandBuilds());
export const getModems = query(build, (b) => data.getModems(b));
export const getModemPackageHeader = query(packageId, (id) => data.getModemPackageHeader(id));
export const getBaseband = query(v.object({ build, family }), (a) => data.getBaseband(a.build, a.family));
export const getBasebandFile = query(v.object({ id: packageId, i: index }), (a) => data.getBasebandFile(a.id, a.i));
export const getBasebandCombos = query(v.object({ id: packageId, sha1: v.string(), tag: v.string() }), (a) =>
  data.getBasebandCombos(a.id, a.sha1, a.tag));
export const getBasebandDiff = query(v.object({ a: build, b: build, family }), (q) => data.getBasebandDiff(q.a, q.b, q.family));
export const getBundleOverrides = query(v.object(bundle), (a) => data.getBundleOverrides(a.kind, a.name, a.slug));
export const getBasebandDefaults = query(v.object({ ...bundle, device: v.optional(device) }), (a) =>
  data.getBasebandDefaults(a.kind, a.name, a.slug, a.device));
export const getBasebandOverride = query(
  v.object({ ...bundle, id: packageId, pri: v.string(), efs: v.string(), i: index }),
  (a) => data.getBasebandOverride(a.kind, a.name, a.slug, a.id, a.pri, a.efs, a.i),
);
