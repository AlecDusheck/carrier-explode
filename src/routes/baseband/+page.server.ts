import { error, redirect } from "@sveltejs/kit";
import { builds, release } from "$lib/server/data";

export const load = async () => {
  const b = release(await builds());
  if (!b) error(404, "No images held.");
  redirect(307, `/baseband/${b.build}`);
};
