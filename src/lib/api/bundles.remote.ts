import * as v from "valibot";
import { query } from "$app/server";
import * as data from "#lib/server/data.ts";
import { build, bundle, pinned } from "./schemas";

export const getIndex = query(() => data.getIndex());
export const getStats = query(() => data.getStats());
export const getManifestFacts = query(() => data.getManifestFacts());
export const guessCarrier = query(() => data.guessCarrier());
export const guessCountry = query(() => data.guessCountry());
export const getVisitorCountry = query(() => data.visitorCountry());
export const guessCarrierName = query(() => data.guessCarrierName());
export const getBundle = query(v.object(bundle), (a) => data.getBundle(a.kind, a.name, a.slug));
export const getHead = query(v.object({ kind: bundle.kind, name: bundle.name }), (a) => data.getHead(a.kind, a.name));
export const getFile = query(v.object({ ...pinned, path: v.string() }), (a) =>
  data.getFile(a.kind, a.name, a.slug, a.path));
/** One diff for /compare and the Changes tab. No `a`: against the version before `b`. */
export const getComparison = query(
  v.object({ a: v.nullable(v.object(bundle)), b: v.object(bundle), path: v.optional(v.string()) }),
  (q) => data.getComparison(q.a, q.b, q.path),
);
export const getRelease = query(build, (b) => data.getRelease(b));
/** Settings few other bundles share; and a phone's override plist beside its modem file. */
export const getRare = query(v.object(bundle), (a) => data.getRare(a.kind, a.name, a.slug));
/** Feature pages: the phones to pick from, one feature across carriers, and one carrier's features. */
export const getFeaturePhones = query(() => data.featurePhones());
export const getFeatureTable = query(v.object({ slug: v.string(), phone: v.string() }), (a) => data.getFeatureTable(a.slug, a.phone));
export const getFeatureSummary = query(v.string(), (phone) => data.getFeatureSummary(phone));
/** A version's phone groups against what each phone had at the version compared against. */
export const getPhoneChanges = query(v.object({ ...pinned, against: v.optional(v.string()) }), (a) =>
  data.getPhoneChanges(a.kind, a.name, a.slug, a.against));
export const getOverridePlist = query(v.object({ ...pinned, path: v.string() }), (a) =>
  data.getOverridePlist(a.kind, a.name, a.slug, a.path));
