import { error } from "@sveltejs/kit";
import { featurePage } from "#lib/feature-pages.ts";

export const load = ({ params }) => {
  const feature = featurePage(params.feature);
  if (!feature) error(404, `No feature ${params.feature}.`);
  return { feature };
};
