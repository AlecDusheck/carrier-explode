/** The best guess's inputs from the request and the index. Reading the request keeps the response out of the shared cache. */

import { getRequestEvent } from "$app/server";
import * as v from "valibot";
import type { Device } from "#lib/device.ts";
import { bestGuess, guessPlatform, type VisitorGuess } from "#lib/guess.ts";
import { featureModels, featurePhones } from "./features";
import { carriers, getCountryCarriers } from "./lists";

/** Where the platform has no carriers in the visitor's country, or the country is unknown. */
const FALLBACK_COUNTRY = "us";

/** An incoming request's cf, which has the visitor's fields; the outgoing kind has no asOrganization. */
const visitorCf = v.object({
	asOrganization: v.string(),
	country: v.fallback(v.nullable(v.pipe(v.string(), v.toLowerCase())), null),
});

/** What Cloudflare says about the visitor, from the request's `cf`; marks the response as theirs. */
function visitor(): { country: string | null; organisation: string | null; mobile: boolean } {
	const { request, locals } = getRequestEvent();
	locals.perVisitor = true;
	const cf = v.safeParse(visitorCf, request.cf);
	return {
		country: cf.success ? cf.output.country : null,
		organisation: cf.success ? cf.output.asOrganization : null,
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
