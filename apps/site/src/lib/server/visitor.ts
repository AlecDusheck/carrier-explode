/** The best guess's inputs from the request and the index. Reading the request keeps the response out of the shared cache. */

import { getRequestEvent } from "$app/server";
import type { Device } from "#lib/device.ts";
import { bestGuess, guessPlatform, type VisitorGuess } from "#lib/guess.ts";
import { featureModels, featurePhones } from "./features";
import { carriers, getCountryCarriers } from "./lists";

/** Where the platform has no carriers in the visitor's country, or the country is unknown. */
const FALLBACK_COUNTRY = "us";

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

/** The guess for a visitor whose browser reports `device`. */
export async function visitorGuess(device: Device): Promise<VisitorGuess> {
	const { country, organisation, mobile } = visitor();
	const platform = guessPlatform(device);
	const [all, local, fallback, phones, models] = await Promise.all([
		carriers(),
		country === null ? [] : getCountryCarriers(platform, country),
		getCountryCarriers(platform, FALLBACK_COUNTRY),
		featurePhones(),
		featureModels(),
	]);
	return bestGuess({
		device,
		country,
		network: mobile ? organisation : null,
		carriers: all,
		local,
		fallback,
		phones: phones.filter((p) => p.platform === platform),
		models: models.filter((m) => m.platform === platform),
	});
}
