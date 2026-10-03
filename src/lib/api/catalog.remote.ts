/** The lists, a source's versions, and the guesses that prefill a list. */

import * as v from "valibot";
import { error } from "@sveltejs/kit";
import { query } from "$app/server";
import type { CarrierSummary, CountrySummary, ReleaseSummary } from "#lib/storage/keys.ts";
import type { SourceRef } from "#lib/schema/types.ts";
import type { Version } from "#lib/types.ts";
import * as catalog from "#lib/server/catalog.ts";
import * as visitor from "#lib/server/visitor.ts";
import { at } from "./schemas";

export const getCarriers = query((): Promise<CarrierSummary[]> => catalog.carrierList());
export const getCountries = query((): Promise<CountrySummary[]> => catalog.countryList());
export const getReleases = query((): Promise<ReleaseSummary[]> => catalog.releaseList());

export const guessCarrier = query((): Promise<string | null> => visitor.guessCarrier());
export const guessCountry = query((): Promise<string | null> => visitor.guessCountry());
export const guessCarrierPage = query((): Promise<string | null> => visitor.guessCarrierPage());
export const getVisitorCountry = query((): string | null => visitor.visitorCountry());

/** What every native view's header shows, on either platform: the source, its versions, the one open, and the head. */
export interface Versions {
  readonly ref: SourceRef;
  readonly timeline: readonly Version[];
  readonly entry: Version;
  readonly previous: Version | null;
  readonly head: string;
}

export const getVersions = query(v.object(at), async (a): Promise<Versions> => {
  const r = await catalog.resolve(a.source, a.slug);
  const timeline = await catalog.versionsOf(r.ref.platform, r.timeline);
  const find = (slug: string | undefined): Version | undefined => timeline.find((e) => e.slug === slug);
  const entry = find(r.entry.slug) ?? timeline[0];
  if (!entry) error(500, `${a.source} has an empty timeline`);
  return { ref: r.ref, timeline, entry, previous: find(r.previous?.slug) ?? null, head: r.head.slug };
});
