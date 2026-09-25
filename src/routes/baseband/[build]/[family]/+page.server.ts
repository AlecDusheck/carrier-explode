import { error } from "@sveltejs/kit";
import { getModems } from "$lib/server/data";

export const load = async ({ params }) => {
  const { modems, version } = await getModems(params.build);
  if (!modems.some((m) => m.family === params.family)) error(404, `iOS ${version} (${params.build}) has no ${params.family} modem package.`);
};
