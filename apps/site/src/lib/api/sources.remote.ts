/** What every source's pages share: the lists, the source head, comparisons, rarity, the visitor guesses, and the feature pages. */

import * as v from "valibot";
import { query } from "$app/server";
import { codeNamed } from "@carrier-explode/db/d1";
import { FEATURE_SLUGS } from "@carrier-explode/schema";
import { getComparison as compare } from "#lib/server/compare.ts";
import { db } from "#lib/server/db.ts";
import * as features from "#lib/server/features.ts";
import { getHead } from "#lib/server/head.ts";
import * as lists from "#lib/server/lists.ts";
import * as scan from "#lib/server/scan.ts";
import * as visitor from "#lib/server/visitor.ts";
import { iso, key, kind, path, phone, platform, ver, verSchema } from "./schemas";

/** One platform's list of one kind. */
export const getList = query(v.object({ platform, kind }), (a) => lists.getListRows(a.platform, a.kind));
/** One platform's carriers in a country. */
export const getCountryCarriers = query(v.object({ platform, iso }), (a) => lists.getCountryCarriers(a.platform, a.iso));
/** A source as its list shows it; null when the index lacks it. Calls in one tick share one lookup. */
export const getListEntry = query.batch(key, async (keys) => {
  const entries = await lists.listEntries(keys);
  return (key) => entries.get(key) ?? null;
});
/** The Pixel a phone's reported model names (`Pixel 9 Pro`), or null. */
export const getPixelOfModel = query(v.pipe(v.string(), v.maxLength(64)), async (model) => (await codeNamed(await db(), "device", model)) ?? null);
/** Every source with its carrier's name: what Compare's boxes complete from. */
export const getSourceBrands = query(lists.allSourceBrands);
/** The platforms each kind of list has, as [kind, platforms] pairs. */
export const getListPlatforms = query(async () => [...(await lists.listPlatforms())].map(([k, ps]) => [k, [...ps]] as const));
export const guessCarrier = query(visitor.guessCarrier);
export const guessCountry = query(visitor.guessCountry);
export const getVisitorCountry = query(visitor.visitorCountry);
export const guessCarrierPages = query(visitor.guessCarrierPages);

/** The source head: the line's versions, the one open and the source's lines. */
export const getSourceHead = query(verSchema, getHead);

/** A side: a version, and the variant of it one phone sees (on Apple, that phone's override file). */
const side = v.object({ ...ver, variant: v.exactOptional(path) });

/** One diff for /compare and the Changes tabs; no `a` means the version before `b`. */
export const getComparison = query(v.object({ a: v.nullable(side), b: side, path: v.exactOptional(path) }), (q) => compare(q.a, q.b, q.path));

export const getRare = query(verSchema, scan.getRare);

export const getFeaturePhones = query(features.featurePhones);
export const getFeaturePhone = query(v.optional(phone), features.featurePhone);
export const getFeatureTable = query(v.object({ slug: v.picklist(FEATURE_SLUGS), phone }), (a) => features.getFeatureTable(a.slug, a.phone));
export const getFeatureSummary = query(phone, features.getFeatureSummary);
