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

export const getBasebandBuilds = query(() => data.basebandBuilds());
export const getBaseband = query(build, (b) => data.getBaseband(b));
export const getBasebandFile = query(v.object({ build, i: v.pipe(v.number(), v.integer()) }), (a) =>
  data.getBasebandFile(a.build, a.i));
export const getBasebandCombos = query(v.object({ build, sha1: v.string(), tag: v.string() }), (a) =>
  data.getBasebandCombos(a.build, a.sha1, a.tag));
export const getBasebandDiff = query(v.object({ a: build, b: build }), (q) => data.getBasebandDiff(q.a, q.b));
export const getBasebandDefaults = query(v.object(bundle), (a) => data.getBasebandDefaults(a.kind, a.name, a.slug));
export const getBasebandOverride = query(
  v.object({ ...bundle, pri: v.string(), efs: v.string(), i: v.pipe(v.number(), v.integer()) }),
  (a) => data.getBasebandOverride(a.kind, a.name, a.slug, a.pri, a.efs, a.i),
);
