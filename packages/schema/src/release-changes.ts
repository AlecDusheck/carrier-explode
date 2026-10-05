/** What each release changed: its sources against the platform's previous release, every device counted. */

import { artifactsOf, compareReleases, lineOf } from "./timeline.ts";
import { newestOf, type DeviceOrder } from "./devices.ts";
import { isSourceKey, RELEASE_PLATFORMS, type Release, type ReleaseChange, type ReleasedEntry, type SourceKey, type Timeline } from "./types.ts";

interface Carried {
  /** Every file the source ships in the release, so a change on any device counts. */
  readonly content: string;
  /** The line a change links to: Apple's main line, Android's newest Pixel carrying it. */
  readonly line: string | null;
}

function carried(r: Release, key: SourceKey, order: DeviceOrder): Carried | null {
  if (r.platform === "ios") {
    const a = artifactsOf(r.sources, key);
    return a ? { content: a.sha, line: null } : null;
  }
  const files = artifactsOf(r.sources, key);
  const line = newestOf(order, files?.flatMap((f) => f.devices) ?? []);
  return files && line !== undefined ? { content: files.map((f) => f.sha).sort().join(","), line } : null;
}

function released(r: Release, key: SourceKey, c: Carried, timeline: Timeline): ReleasedEntry {
  const entry = lineOf(timeline, c.line).find((e) => e.copies.some((x) => x.kind === "image" && x.releases.includes(r.id)));
  if (entry === undefined) throw new Error(`index: ${key} has no entry from ${r.id} on line ${c.line ?? "main"}`);
  return { line: c.line, slug: entry.slug, version: entry.version };
}

/** Release id → its changes; a platform's first release has none. */
export function releaseChanges(releases: readonly Release[], timelineOf: (key: SourceKey) => Timeline, order: DeviceOrder): Map<string, ReleaseChange[]> {
  const out = new Map<string, ReleaseChange[]>();
  for (const platform of RELEASE_PLATFORMS) {
    const ordered = releases.filter((r) => r.platform === platform).sort(compareReleases);
    ordered.forEach((now, i) => {
      const was = ordered[i - 1];
      if (was === undefined) return;
      const keys = [...new Set([...Object.keys(now.sources), ...Object.keys(was.sources)])].filter(isSourceKey).sort();
      out.set(now.id, keys.flatMap((source): ReleaseChange[] => {
        const a = carried(was, source, order), b = carried(now, source, order);
        if (a && b && a.content === b.content) return [];
        const t = timelineOf(source);
        if (!a && b) return [{ source, kind: "added", to: released(now, source, b, t) }];
        if (a && !b) return [{ source, kind: "removed", from: released(was, source, a, t) }];
        return a && b ? [{ source, kind: "changed", from: released(was, source, a, t), to: released(now, source, b, t) }] : [];
      }));
    });
  }
  return out;
}
