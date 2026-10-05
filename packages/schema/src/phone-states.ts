/** What each phone of its platform's current release reads from every carrier source: the Features pages' table. */

import { isSourceKey, RELEASE_PLATFORMS, sourceOf, type FeatureIndex, type HeadStates, type PhoneStates, type ReleasePlatform, type ReleaseSummary } from "./types.ts";

/** The newest release of a platform that is not a prerelease, else its newest. `releases` newest first, as the index orders them. */
export function currentRelease(releases: readonly ReleaseSummary[], platform: ReleasePlatform): ReleaseSummary | undefined {
  const mine = releases.filter((r) => r.platform === platform);
  return mine.find((r) => r.platform === "android" || !r.prerelease) ?? mine[0];
}

/** The group a device reads: the one naming it, else the one for every device no group names. */
const groupFor = (groups: readonly HeadStates[], device: string): HeadStates | undefined =>
  groups.find((g) => g.devices.kind === "listed" && g.devices.devices.includes(device)) ?? groups.find((g) => g.devices.kind === "rest");

/** A source that ships nothing for a phone has no row for it. */
export function phoneStates(releases: readonly ReleaseSummary[], features: FeatureIndex): PhoneStates[] {
  const sources = Object.entries(features).flatMap(([key, groups]) => (isSourceKey(key) ? [{ key, ref: sourceOf(key), groups }] : []));
  return RELEASE_PLATFORMS.flatMap((platform) => {
    const carriers = sources.filter((s) => s.ref.platform === platform && s.ref.kind === "carrier");
    return (currentRelease(releases, platform)?.devices ?? []).flatMap((device) => carriers.flatMap((s): PhoneStates[] => {
      const group = groupFor(s.groups, device);
      return group === undefined ? [] : [{ device, source: s.key, states: group.states }];
    }));
  });
}
