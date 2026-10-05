import { error } from "@sveltejs/kit";
import { countryName } from "@carrier-explode/schema";
import { shipsKind } from "@carrier-explode/schema/types";

/** Only a platform that ships no country files has a country page of its carriers; elsewhere a country is a bundle. */
export const load = ({ params }): { readonly country: string } => {
  const country = countryName(params.iso);
  if (params.kind !== "countries" || shipsKind(params.platform, "country") || country === undefined) error(404, "Not found");
  return { country };
};
