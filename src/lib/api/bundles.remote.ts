import * as v from "valibot";
import { query } from "$app/server";
import * as data from "$lib/server/data";

const kind = v.picklist(["carriers", "countries", "watch"]);
const id = v.object({ kind, name: v.string(), slug: v.optional(v.string()) });
const pinned = v.object({ kind, name: v.string(), slug: v.string() });

export const getIndex = query(() => data.getIndex());
export const getStats = query(() => data.getStats());
export const guessCarrier = query(() => data.guessCarrier());
export const guessCountry = query(() => data.guessCountry());
export const getBundle = query(id, (a) => data.getBundle(a.kind, a.name, a.slug));
export const getFile = query(v.object({ ...pinned.entries, path: v.string() }), (a) =>
  data.getFile(a.kind, a.name, a.slug, a.path));
/** One diff for /compare and the Changes tab. No `a`: against the version before `b`. */
export const getComparison = query(
  v.object({ a: v.nullable(id), b: id, path: v.optional(v.string()) }),
  (q) => data.getComparison(q.a, q.b, q.path),
);
export const getRelease = query(v.string(), (build) => data.getRelease(build));
