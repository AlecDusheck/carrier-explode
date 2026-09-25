import { error, redirect } from "@sveltejs/kit";
import { builds, getModems, release } from "$lib/server/data";
import { defaultModem } from "$lib/phones";

export const load = async () => {
  const b = release(await builds());
  if (!b) error(404, "No images held.");
  const { modems } = await getModems(b.build);
  const m = defaultModem(modems);
  redirect(307, m ? `/baseband/${b.build}/${m.family}` : `/baseband/${b.build}`);
};
