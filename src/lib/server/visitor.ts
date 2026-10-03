/**
 * Guesses from the request itself: where the visitor is and, on a phone, which
 * network they are on. Each marks the response as the visitor's own, so a page
 * that shows one is never put in the shared cache (hooks.server.ts reads
 * `locals.perVisitor`; a remote function cannot set a header, but it shares
 * locals with the page event).
 */

import { getRequestEvent } from "$app/server";
import { carrierList, countryList } from "./catalog";
import { guessCarrierQuery, guessCarrierSlug } from "./guess";

/** A request as it reached the worker; Request alone also covers outgoing ones, whose `cf` differs. */
type IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function incoming(): IncomingRequest {
  const { request, locals } = getRequestEvent();
  locals.perVisitor = true;
  return request;
}

/** The visitor's country as an ISO code ("us"). */
export function visitorCountry(): string | null {
  return incoming().cf?.country?.toLowerCase() ?? null;
}

/** The visitor's country, when the site has a page for it. */
export async function guessCountry(): Promise<string | null> {
  const cc = visitorCountry();
  return cc && (await countryList()).some((c) => c.iso === cc) ? cc : null;
}

/** On a phone, a carrier search guessed from the network the request came in on. */
export async function guessCarrier(): Promise<string | null> {
  const request = incoming();
  if (!/Mobi|Android|iPhone/i.test(request.headers.get("user-agent") ?? "")) return null;
  return guessCarrierQuery(request.cf?.asOrganization, await carrierList());
}

/** On a phone, the carrier the visitor's network most likely is, by slug. */
export async function guessCarrierPage(): Promise<string | null> {
  const query = await guessCarrier();
  return query && guessCarrierSlug(query, await carrierList(), visitorCountry());
}
