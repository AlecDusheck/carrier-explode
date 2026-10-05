/** The Pixels the OTA page lists, each released in the month of its first build, and the held builds the page no longer lists. */

import type { ListedDevice } from "@carrier-explode/db";
import type { ReleaseSummary } from "@carrier-explode/schema/types";
import { BUILD_NUMBERS, foldName } from "./build-numbers.ts";
import { OTA_PAGE, type OtaDevice } from "./page.ts";

/** The earlier of the OTA page's first build and the build numbers' first patch level for the phone of that name, with the page that gave it. */
export const pixelDevices = (page: readonly OtaDevice[], firstPatches: ReadonlyMap<string, string>): ListedDevice[] =>
  page.flatMap((d) => {
    const [ota] = d.builds.map((b) => b.patch).toSorted();
    if (ota === undefined) return [];
    const listed = firstPatches.get(foldName(d.name));
    const [released, evidence] = listed !== undefined && listed < ota ? [listed, BUILD_NUMBERS] : [ota, OTA_PAGE];
    return [{ code: d.device, family: "android", released, boards: [], evidence }];
  });

/** Each held build with the devices it was held for that the OTA page no longer lists it for: what a purge of Google's took. */
export function delisted(page: readonly OtaDevice[], held: ReadonlyArray<Pick<ReleaseSummary, "id" | "devices">>): string[] {
  const listed = new Map(page.map((d) => [d.device, new Set(d.builds.map((b) => b.build))]));
  return held.flatMap((r) => {
    const gone = r.devices.filter((device) => !listed.get(device)?.has(r.id));
    return gone.length ? [`${r.id}: ${gone.join(", ")}`] : [];
  });
}
