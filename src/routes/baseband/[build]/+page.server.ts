import { error, redirect } from "@sveltejs/kit";
import { getModems } from "#lib/server/data.ts";
import { defaultModem } from "#lib/phones.ts";

/** The package serving the newest named phone; the others are a tab away. */
export const load = async ({ params }) => {
  const { modems, version } = await getModems(params.build);
  if (!modems.length) error(404, `No modem packages for iOS ${version} (${params.build}) yet.`);
  redirect(307, `/baseband/${params.build}/${defaultModem(modems).family}`);
};
