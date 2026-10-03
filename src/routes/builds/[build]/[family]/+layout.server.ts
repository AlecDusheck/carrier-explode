import { error, redirect } from "@sveltejs/kit";
import { modemHref } from "#lib/format.ts";
import { getModems } from "#lib/server/data.ts";

export const load = async ({ params, url }) => {
  const { modems, version } = await getModems(params.build);
  if (!modems.some((m) => m.family === params.family)) error(404, `iOS ${version} (${params.build}) has no ${params.family} modem package.`);
  // Links from before policy files and changes were tabs.
  const file = url.searchParams.get("file");
  if (file !== null) redirect(308, modemHref(params.build, params.family, `policy/${file}`));
  const vs = url.searchParams.get("vs");
  if (vs !== null) redirect(308, modemHref(params.build, params.family, "changes") + `?against=${encodeURIComponent(vs)}`);
};
