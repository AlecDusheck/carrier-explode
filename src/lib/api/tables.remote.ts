import * as v from "valibot";
import { query } from "$app/server";
import * as data from "$lib/server/data";

export const getCbs = query(() => data.getCbs());
export const getPlmn = query(() => data.getPlmn());

export const scanKey = query(
  v.object({
    path: v.string(),
    file: v.string(),
    scope: v.string(),
  }),
  (a) => data.scanKey(a.path, a.file, a.scope),
);

const build = v.pipe(v.string(), v.regex(/^\w{3,16}$/));
const bundle = {
  kind: v.picklist(["carriers", "countries", "watch"]),
  name: v.string(),
  slug: v.optional(v.string()),
};

const id = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));
const family = v.pipe(v.string(), v.regex(/^\w{1,16}$/));

export const getBasebandBuilds = query(() => data.basebandBuilds());
export const getModems = query(build, (b) => data.getModems(b));
export const getModemPackage = query(id, (i) => data.getModemPackage(i));
export const getBaseband = query(v.object({ build, family: v.optional(family) }), (a) => data.getBaseband(a.build, a.family));
export const getBasebandFile = query(v.object({ id, i: v.pipe(v.number(), v.integer()) }), (a) =>
  data.getBasebandFile(a.id, a.i));
export const getBasebandCombos = query(v.object({ id, sha1: v.string(), tag: v.string() }), (a) =>
  data.getBasebandCombos(a.id, a.sha1, a.tag));
export const getBasebandDiff = query(v.object({ a: build, b: build, family }), (q) => data.getBasebandDiff(q.a, q.b, q.family));
export const getBasebandDefaults = query(v.object({ ...bundle, family: v.optional(family) }), (a) =>
  data.getBasebandDefaults(a.kind, a.name, a.slug, a.family));
export const getBasebandOverride = query(
  v.object({ ...bundle, id, pri: v.string(), efs: v.string(), i: v.pipe(v.number(), v.integer()) }),
  (a) => data.getBasebandOverride(a.kind, a.name, a.slug, a.id, a.pri, a.efs, a.i),
);
