import * as v from "valibot";
import { query } from "$app/server";
import * as data from "$lib/server/data";
import { build, bundle, pinned } from "./schemas";

export const getIndex = query(() => data.getIndex());
export const getStats = query(() => data.getStats());
export const guessCarrier = query(() => data.guessCarrier());
export const guessCountry = query(() => data.guessCountry());
export const getBundle = query(v.object(bundle), (a) => data.getBundle(a.kind, a.name, a.slug));
export const getFile = query(v.object({ ...pinned, path: v.string() }), (a) =>
  data.getFile(a.kind, a.name, a.slug, a.path));
/** One diff for /compare and the Changes tab. No `a`: against the version before `b`. */
export const getComparison = query(
  v.object({ a: v.nullable(v.object(bundle)), b: v.object(bundle), path: v.optional(v.string()) }),
  (q) => data.getComparison(q.a, q.b, q.path),
);
export const getRelease = query(build, (b) => data.getRelease(b));
