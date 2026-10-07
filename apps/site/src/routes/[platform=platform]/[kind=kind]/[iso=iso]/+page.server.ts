import { error } from "@sveltejs/kit";
import { countryName } from "@carrier-explode/schema";
import { shipsKind } from "@carrier-explode/schema/types";
import { getCountryCarriers } from "#lib/server/lists.ts";

/** Only a platform that ships no country files has a country page of its carriers, and only where it has some. */
export const load = async ({ params }): Promise<{ readonly country: string }> => {
	const country = countryName(params.iso);
	if (
		params.kind !== "countries" ||
		shipsKind(params.platform, "country") ||
		country === undefined ||
		(await getCountryCarriers(params.platform, params.iso)).length === 0
	)
		error(404, "Not found");
	return { country };
};
