/** The Features pages: one feature on one phone of the current releases, for every carrier. */

import { error } from "@sveltejs/kit";
import { currentPhones, statesOn as phoneStates } from "@carrier-explode/db/d1";
import { FEATURE_SLUGS, needs5G, type FeatureSlug, type FeatureState, type Phone } from "@carrier-explode/schema";
import { perRequest } from "./cache";
import { db } from "./db";
import { getList, type ListEntry } from "./lists";

/** The current releases' phones, by platform and newest first, each with the radio the index found its settings show. */
export const featurePhones = perRequest(async (): Promise<Phone[]> => currentPhones(await db()));

/** The phone a features page is for: the one named, else the newest. */
export async function featurePhone(named: string | undefined): Promise<Phone | null> {
  const phones = await featurePhones();
  return phones.find((p) => p.code === named) ?? phones[0] ?? null;
}

async function mustPhone(code: string): Promise<Phone> {
  const phone = (await featurePhones()).find((p) => p.code === code);
  if (!phone) error(404, `No phone ${code} in the current releases.`);
  return phone;
}

/** "unknown": the source ships nothing for this phone. */
export type PhoneState = FeatureState | "unknown";

/** Each carrier source of the phone's platform, with the feature states that phone reads. */
async function statesOn(phone: Phone): Promise<Array<{ readonly entry: ListEntry; readonly states: Readonly<Record<string, FeatureState>> | undefined }>> {
  const [list, rows] = await Promise.all([getList(phone.platform, "carrier"), phoneStates(await db(), phone.code)]);
  const states = new Map(rows.map((r) => [r.source, r.states]));
  return list.map((entry) => ({ entry, states: states.get(entry.key) }));
}

export type FeatureRow = ListEntry & { readonly state: PhoneState };

/** A phone without a 5G modem can use a 5G feature with no carrier. */
const unusable = (slug: FeatureSlug, phone: Phone): boolean => needs5G(slug) && !phone.has5G;

/** Every carrier's state for the feature on the phone, unless the phone cannot use it at all. */
export type FeatureTable = { readonly unusable: true } | { readonly unusable: false; readonly rows: readonly FeatureRow[] };

export async function getFeatureTable(slug: FeatureSlug, phoneId: string): Promise<FeatureTable> {
  const phone = await mustPhone(phoneId);
  if (unusable(slug, phone)) return { unusable: true };
  return { unusable: false, rows: (await statesOn(phone)).map(({ entry, states }) => ({ ...entry, state: states?.[slug] ?? "unknown" })) };
}

export interface FeatureCount {
  readonly slug: FeatureSlug;
  readonly unusable: boolean;
  readonly counts: Readonly<Record<PhoneState, number>>;
}

/** How many carriers give each feature on one phone. */
export async function getFeatureSummary(phoneId: string): Promise<FeatureCount[]> {
  const phone = await mustPhone(phoneId);
  const sources = await statesOn(phone);
  return FEATURE_SLUGS.map((slug) => {
    const counts = { on: 0, available: 0, no: 0, unknown: 0 };
    for (const { states } of sources) counts[states?.[slug] ?? "unknown"]++;
    return { slug, unusable: unusable(slug, phone), counts };
  });
}
