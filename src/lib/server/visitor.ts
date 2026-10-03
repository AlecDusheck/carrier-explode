/**
 * Guesses from the request: where the visitor is and, on a phone, their
 * network. Each marks the response as the visitor's own (locals.perVisitor),
 * which keeps it out of the shared cache.
 */

import { getRequestEvent } from "$app/server";
import { parseSourceKey, sourcePath } from "#lib/schema/types.ts";
import { carrierList, countryList } from "./catalog";
import { guessCarrierOf, guessCarrierQuery } from "./guess";

/** A request as it reached the worker, whose `cf` describes the visitor. */
type IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function incoming(): IncomingRequest {
  const { request, locals } = getRequestEvent();
  locals.perVisitor = true;
  return request;
}

/** ISO code ("us"). */
export function visitorCountry(): string | null {
  return incoming().cf?.country?.toLowerCase() ?? null;
}

/** The visitor's country, when the site has bundles for it. */
export async function guessCountry(): Promise<string | null> {
  const cc = visitorCountry();
  return cc && (await countryList()).some((c) => c.iso === cc) ? cc : null;
}

/** On a phone, a carrier search from the network the request came in on. */
export async function guessCarrier(): Promise<string | null> {
  const request = incoming();
  if (!/Mobi|Android|iPhone/i.test(request.headers.get("user-agent") ?? "")) return null;
  return guessCarrierQuery(request.cf?.asOrganization, await carrierList());
}

/** The pages of the carrier the visitor's network most likely is, one per platform. */
export async function guessCarrierPages(): Promise<string[]> {
  const query = await guessCarrier();
  const carrier = query ? guessCarrierOf(query, await carrierList(), visitorCountry()) : null;
  return (carrier?.members ?? []).flatMap((k) => {
    const ref = parseSourceKey(k);
    return ref ? [sourcePath(ref)] : [];
  });
}
