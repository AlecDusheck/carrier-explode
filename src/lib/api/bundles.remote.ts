/** A page's versions and what each holds: the lists, the version strip, iOS bundles, and the feature pages. */

import * as v from "valibot";
import { query } from "$app/server";
import type { DecodedFile } from "#lib/decode/index.ts";
import * as catalog from "#lib/server/catalog.ts";
import * as features from "#lib/server/features.ts";
import * as ios from "#lib/server/ios.ts";
import * as lists from "#lib/server/lists.ts";
import * as pair from "#lib/server/pair.ts";
import { onPlatform, sourceAt } from "#lib/server/at.ts";
import * as scan from "#lib/server/scan.ts";
import { getStrip, type Strip } from "#lib/server/strip.ts";
import * as visitor from "#lib/server/visitor.ts";
import { manifestCounts } from "#lib/server/apple.ts";
import type { CbsRow, Kind } from "#lib/types.ts";
import { bundle, kind, path, phone, pinned } from "./schemas";

export const getIndex = query((): Promise<lists.Lists> => lists.getLists());
export const getManifestFacts = query(async (): Promise<{ counts: Record<string, number> }> => ({ counts: await manifestCounts() }));
export const guessCarrier = query((): Promise<string | null> => visitor.guessCarrier());
export const guessCountry = query((): Promise<string | null> => visitor.guessCountry());
export const getVisitorCountry = query((): string | null => visitor.visitorCountry());
export const guessCarrierName = query((): Promise<string | null> => visitor.guessCarrierPage());

/** The version strip: both platforms' versions of a page, and the one open. */
export const getVersions = query(v.object(bundle), (a): Promise<Strip> => getStrip(a.kind, a.name, a.slug));

/** The version a page opens on, without opening it: what a wiki link names. */
export const getHead = query(v.object({ kind, name: bundle.name }), async (a): Promise<{ slug: string; version: string }> => {
  const { source } = await sourceAt(a.kind, a.name);
  const { head } = await catalog.resolve(source);
  return { slug: head.slug, version: head.version };
});

export interface Related {
  /** A carrier bundle's home country bundle. */
  readonly country: string | null;
  /** A country bundle's carriers. */
  readonly carriers: readonly string[];
}

export type PageBundle = ios.IosBundle & { readonly kind: Kind; readonly name: string; readonly related: Related };

/** An iOS bundle at a version of a page, opened. */
export const getBundle = query(v.object(bundle), async (a): Promise<PageBundle> => {
  const at = await onPlatform("ios", a.kind, a.name, a.slug);
  const b = await ios.getBundle(at.source, at.slug);
  const carriers = a.kind === "countries" ? await lists.carriersIn(at.page.doc.carrier.iso) : [];
  return { ...b, kind: a.kind, name: a.name, related: { country: b.home, carriers } };
});

export const getFile = query(v.object({ ...pinned, path }), async (a): Promise<DecodedFile> => {
  const at = await onPlatform("ios", a.kind, a.name, a.slug);
  return ios.getFile(at.source, a.slug, a.path);
});

export const getAlerts = query(v.object(pinned), async (a): Promise<CbsRow | null> => {
  const at = await onPlatform("ios", a.kind, a.name, a.slug);
  return ios.getAlerts(at.source, a.slug);
});

const side = v.object(bundle);

/** One side of a comparison, as a page names it. */
type ComparedPage = { readonly kind: Kind; readonly name: string };

export type Comparison =
  | ({ readonly by: "files" } & ios.NativeComparison & { readonly pages: { readonly a: ComparedPage | null; readonly b: ComparedPage } })
  | ({ readonly by: "concepts" } & pair.CrossComparison & { readonly pages: { readonly a: ComparedPage; readonly b: ComparedPage } });

/**
 * One diff for /compare and the Changes tab. No `a`: against the version before `b`.
 * Two iOS versions compare file by file; any pair with an Android side compares
 * concept by concept, the only terms both platforms share.
 */
export const getComparison = query(
  v.object({ a: v.nullable(side), b: side, path: v.exactOptional(path) }),
  async (q): Promise<Comparison> => {
    const [b, a] = await Promise.all([sourceAt(q.b.kind, q.b.name, q.b.slug), q.a ? sourceAt(q.a.kind, q.a.name, q.a.slug) : null]);
    const pages = { a: q.a && { kind: q.a.kind, name: q.a.name }, b: { kind: q.b.kind, name: q.b.name } };
    if (b.platform === "ios" && (!a || a.platform === "ios")) {
      const cmp = await ios.getComparison(a && { source: a.source, slug: a.slug }, { source: b.source, slug: b.slug }, q.path);
      return { by: "files", ...cmp, pages };
    }
    const left = a ?? { ...b, slug: (await catalog.resolve(b.source, b.slug)).previous?.slug };
    const cmp = await pair.getCrossComparison(left, b);
    return { by: "concepts", ...cmp, pages: { a: pages.a ?? pages.b, b: pages.b } };
  },
);

/** The Overview's "iOS and Android" section: a chosen iPhone against a chosen Pixel. */
export const getPair = query(v.object({ kind, name: bundle.name, iphone: v.exactOptional(phone), pixel: v.exactOptional(phone) }), (a): Promise<pair.Pair | null> =>
  pair.getPair(a.kind, a.name, a.iphone, a.pixel));

/** Settings few other sources share. */
export const getRare = query(v.object(bundle), async (a): Promise<scan.Rare> => {
  const at = await sourceAt(a.kind, a.name, a.slug);
  return scan.getRare(at.source, at.slug);
});

/** Feature pages: the phones to pick from, one feature across carriers, and every feature's count. */
export const getFeaturePhones = query((): Promise<features.FeaturePhone[]> => features.featurePhones());
export const getFeatureTable = query(v.object({ slug: v.string(), phone }), (a): Promise<features.FeatureTable> => features.getFeatureTable(a.slug, a.phone));
export const getFeatureSummary = query(phone, (p): Promise<features.FeatureCount[]> => features.getFeatureSummary(p));

/** A version's phone groups against what each phone had at the version compared against. */
export const getPhoneChanges = query(v.object({ ...pinned, against: v.exactOptional(v.string()) }), async (a): Promise<ios.PhoneChange[] | null> => {
  const at = await onPlatform("ios", a.kind, a.name, a.slug);
  return ios.getPhoneChanges(at.source, a.slug, a.against);
});

export const getOverridePlist = query(v.object({ ...pinned, path }), async (a): Promise<ios.OverridePlist | null> => {
  const at = await onPlatform("ios", a.kind, a.name, a.slug);
  return ios.getOverridePlist(at.source, a.slug, a.path);
});
