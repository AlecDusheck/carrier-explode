import { error, redirect } from "@sveltejs/kit";
import { builds, getModems, release } from "#lib/server/data.ts";
import { defaultModem } from "#lib/phones.ts";

export const load = async () => {
  const b = release(await builds());
  if (!b) error(404, "No images held.");
  const { modems } = await getModems(b.build);
  const m = defaultModem(modems);
  redirect(307, m ? `/builds/${b.build}/${m.family}` : `/builds/${b.build}`);
};
