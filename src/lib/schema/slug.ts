/** Carrier ids: the primary member's name (`ATT_US`), or `<platform>-<name>` when taken; kept across builds while still one of the carrier's names. */

import type { Platform } from "./types.ts";

export interface IdMember {
  readonly key: string;
  readonly platform: Platform;
  readonly name: string;
}

const ownIds = (members: readonly IdMember[]): Set<string> => new Set(members.flatMap((m) => [m.name, `${m.platform}-${m.name}`]));

/** One id per carrier (members primary first), in input order; larger carriers choose first, so a split's larger part keeps the old id. */
export function assignIds(carriers: ReadonlyArray<readonly IdMember[]>, previous: Readonly<Record<string, string>> = {}): string[] {
  const taken = new Set<string>();
  const out = carriers.map(() => "");
  const order = carriers.map((ms, i) => ({ ms, i })).sort((a, b) => b.ms.length - a.ms.length || a.i - b.i);
  for (const { ms, i } of order) {
    const own = ownIds(ms);
    const votes = new Map<string, number>();
    for (const m of ms) {
      const id = previous[m.key];
      if (id !== undefined && own.has(id)) votes.set(id, (votes.get(id) ?? 0) + 1);
    }
    const kept = [...votes].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([id]) => id);
    const head = ms[0];
    const fresh = head ? [head.name, `${head.platform}-${head.name}`] : [];
    const id = [...kept, ...fresh].find((c) => !taken.has(c));
    if (id === undefined) throw new Error(`carrier ids: no free id for ${ms.map((m) => m.key).join(", ")}`);
    taken.add(id);
    out[i] = id;
  }
  return out;
}
