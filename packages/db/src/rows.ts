/** The index as table rows. */

import { isSourceKey, sourceOf, type IndexOutput } from "@carrier-explode/schema";
import type { Row, Rows } from "./tables.ts";

export function indexRows(out: IndexOutput): Rows {
  const platformOf = new Map(out.releases.map((r) => [r.id, r.platform]));
  const summaries = new Map(out.carriers.map((c) => [c.id, c]));
  return {
    releases: out.releases.map((summary, sort): Row<"releases"> => ({ platform: summary.platform, id: summary.id, sort, summary })),
    release_changes: Object.entries(out.changes).flatMap(([release, changes]) => {
      const platform = platformOf.get(release);
      if (platform === undefined) throw new Error(`index: changes for ${release}, which is not a release`);
      return changes.map((change): Row<"release_changes"> => ({ platform, release, source: change.source, change }));
    }),
    carriers: out.docs.map(({ carrier, modems }): Row<"carriers"> => {
      const summary = summaries.get(carrier.id);
      return { id: carrier.id, kind: summary === undefined ? "country" : "carrier", iso: carrier.iso ?? null, carrier, modems, summary: summary ?? null };
    }),
    countries: out.countries.map((summary): Row<"countries"> => ({ iso: summary.iso, summary })),
    sources: out.docs.flatMap((doc) => Object.entries(doc.sources).map(([key, timeline]): Row<"sources"> => {
      if (!isSourceKey(key)) throw new Error(`index: ${doc.carrier.id} holds ${key}, which is not a source key`);
      const ref = sourceOf(key);
      return { key, platform: ref.platform, kind: ref.kind, name: ref.name, carrier: doc.carrier.id, timeline };
    })),
    phone_states: out.phoneStates.map((p): Row<"phone_states"> => ({ device: p.device, source: p.source, states: p.states })),
    phones: out.phones.map((p, sort): Row<"phones"> => ({ code: p.code, platform: p.platform, name: p.name, sort, has5G: p.has5G })),
    names: out.names.map((n): Row<"names"> => ({ subject: n.subject, code: n.code, name: n.name })),
    legacy: out.legacy.map((r): Row<"legacy"> => ({ src: r.from, dst: r.to })),
  };
}
