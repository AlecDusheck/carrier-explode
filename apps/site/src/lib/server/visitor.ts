/** Guesses from the request: the visitor's country and, on a phone, network. Each keeps the response out of the shared cache. */

import { getRequestEvent } from "$app/server";
import { sourceOf, sourcePath } from "@carrier-explode/schema/types";
import { carrierList, countryList } from "./catalog";
import { guessCarrierOf, guessCarrierQuery } from "./guess";

/** What Cloudflare says about the visitor, from the request's `cf`; marks the response as theirs. */
function visitor(): { country: string | null; organisation: string | null; mobile: boolean } {
  const { request, locals } = getRequestEvent();
  locals.perVisitor = true;
  // An incoming request's cf has the visitor's fields; `in` tells it from the outgoing kind.
  const cf = request.cf && "asOrganization" in request.cf ? request.cf : undefined;
  const country: unknown = cf?.country;
  const organisation: unknown = cf?.asOrganization;
  return {
    country: typeof country === "string" ? country.toLowerCase() : null,
    organisation: typeof organisation === "string" ? organisation : null,
    mobile: /Mobi|Android|iPhone/i.test(request.headers.get("user-agent") ?? ""),
  };
}

/** ISO code ("us"). */
export function visitorCountry(): string | null {
  return visitor().country;
}

/** The visitor's country by name, when the site has bundles for it. */
export async function guessCountry(): Promise<string | null> {
  const cc = visitorCountry();
  return cc === null ? null : (await countryList()).find((c) => c.iso === cc)?.name ?? null;
}

/** On a phone, a carrier search from the network the request came in on. */
export async function guessCarrier(): Promise<string | null> {
  const { mobile, organisation } = visitor();
  return mobile ? guessCarrierQuery(organisation ?? undefined, await carrierList()) : null;
}

/** The pages of the carrier the visitor's network most likely is, one per platform. */
export async function guessCarrierPages(): Promise<string[]> {
  const query = await guessCarrier();
  const carrier = query ? guessCarrierOf(query, await carrierList(), visitorCountry()) : null;
  return (carrier?.members ?? []).map((k) => sourcePath(sourceOf(k)));
}
