/** A source's pages: the lists, the bundle head, Apple bundles, comparisons, and the feature pages. */

import * as v from "valibot";
import { error } from "@sveltejs/kit";
import { query } from "$app/server";
import type { DecodedFile } from "#lib/decode/index.ts";
import { decoderFamily, parseSourceKey } from "#lib/schema/types.ts";
import { manifestCounts } from "#lib/server/apple.ts";
import * as features from "#lib/server/features.ts";
import { getHead, type BundleHead } from "#lib/server/head.ts";
import * as ios from "#lib/server/ios.ts";
import * as lists from "#lib/server/lists.ts";
import * as pair from "#lib/server/pair.ts";
import * as scan from "#lib/server/scan.ts";
import * as visitor from "#lib/server/visitor.ts";
import type { CbsRow } from "#lib/types.ts";
import { path, phone, pinned, source, ver } from "./schemas";

export const getIndex = query((): Promise<lists.Lists> => lists.getLists());
export const getManifestCounts = query((): Promise<Record<string, number>> => manifestCounts());
export const guessCarrier = query((): Promise<string | null> => visitor.guessCarrier());
export const guessCountry = query((): Promise<string | null> => visitor.guessCountry());
export const getVisitorCountry = query((): string | null => visitor.visitorCountry());
export const guessCarrierPages = query((): Promise<string[]> => visitor.guessCarrierPages());

/** The bundle head: the line's versions, the one open, the source's lines and its counterparts. */
export const getBundleHead = query(v.object(ver), (a): Promise<BundleHead> => getHead(a));

export const getBundle = query(v.object(ver), (a): Promise<ios.IosBundle> => ios.getBundle(a));
export const getFile = query(v.object({ ...pinned, path }), (a): Promise<DecodedFile> => ios.getFile(a, a.path));
export const getAlerts = query(v.object(pinned), (a): Promise<CbsRow | null> => ios.getAlerts(a));

export type Comparison =
  | ({ readonly by: "files" } & ios.NativeComparison)
  | ({ readonly by: "concepts" } & pair.CrossComparison);

const isApple = (key: string): boolean => {
  const ref = parseSourceKey(key);
  return ref !== undefined && decoderFamily(ref.platform) === "apple";
};

/**
 * One diff for /compare and the Changes tab; no `a` means the version before `b`.
 * Two Apple bundles compare file by file; anything with an Android side, concept by concept.
 */
export const getComparison = query(
  v.object({ a: v.nullable(v.object(ver)), b: v.object(ver), path: v.exactOptional(path) }),
  async (q): Promise<Comparison> => {
    if (isApple(q.b.source) && (!q.a || isApple(q.a.source))) return { by: "files", ...(await ios.getComparison(q.a, q.b, q.path)) };
    if (!q.a) error(400, "Compare an Android version against a named one; its own changes are its Changes tab.");
    return { by: "concepts", ...(await pair.getCrossComparison(q.a, q.b)) };
  },
);

/** The Overview's "iOS and Android" section. */
export const getPair = query(v.object({ source, apple: v.exactOptional(phone), android: v.exactOptional(phone) }), (a): Promise<pair.Pair | null> =>
  pair.getPair(a.source, a));

export const getRare = query(v.object(ver), (a): Promise<scan.Rare> => scan.getRare(a));

export const getFeaturePhones = query((): Promise<features.FeaturePhone[]> => features.featurePhones());
export const getFeatureTable = query(v.object({ slug: v.string(), phone }), (a): Promise<features.FeatureTable> => features.getFeatureTable(a.slug, a.phone));
export const getFeatureSummary = query(phone, (p): Promise<features.FeatureCount[]> => features.getFeatureSummary(p));

export const getPhoneChanges = query(v.object({ ...pinned, against: v.exactOptional(v.string()) }), (a): Promise<ios.PhoneChange[] | null> =>
  ios.getPhoneChanges(a, a.against));
export const getOverridePlist = query(v.object({ ...pinned, path }), (a): Promise<ios.OverridePlist | null> => ios.getOverridePlist(a, a.path));
