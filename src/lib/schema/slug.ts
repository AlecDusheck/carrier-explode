/**
 * Carrier URL slugs: kebab-case of the display name plus ISO (`t-mobile-us`,
 * `att-us`). Published slugs are links people keep, so a carrier keeps the
 * slug its members had in the previous index; only a carrier none of whose
 * members was published gets a fresh one.
 */

/** `AT&T` -> `att`, `Telefónica Movistar` -> `telefonica-movistar`. Empty when nothing Latin is left (`ドコモ`). */
export function kebab(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[&'’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function baseSlug(name: string, iso: string | undefined, fallback: string): string {
  const stem = kebab(name) || kebab(fallback) || "carrier";
  return iso && !stem.endsWith(`-${iso}`) ? `${stem}-${iso}` : stem;
}

export interface SlugRequest {
  /** sourceKeys of the carrier's members. */
  readonly members: readonly string[];
  readonly name: string;
  readonly iso: string | undefined;
  /** Used when the name has no Latin letters. */
  readonly fallback: string;
}

/**
 * One slug per request, in request order. A previous slug is reused when most
 * of the members that had one agree on it and no larger carrier took it first;
 * requests are served largest first so a split carrier's bigger half keeps the
 * name. New slugs never take one a previous carrier held.
 */
export function assignSlugs(requests: readonly SlugRequest[], previous: Readonly<Record<string, string>> = {}): string[] {
  const taken = new Set<string>();
  const retired = new Set(Object.values(previous));
  const out: string[] = new Array<string>(requests.length).fill("");
  const order = requests.map((r, i) => ({ r, i })).sort((a, b) => b.r.members.length - a.r.members.length || a.i - b.i);
  const fresh: Array<{ r: SlugRequest; i: number }> = [];
  for (const { r, i } of order) {
    const votes = new Map<string, number>();
    for (const m of r.members) {
      const s = previous[m];
      if (s !== undefined) votes.set(s, (votes.get(s) ?? 0) + 1);
    }
    const reuse = [...votes].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([s]) => s).find((s) => !taken.has(s));
    if (reuse === undefined) { fresh.push({ r, i }); continue; }
    taken.add(reuse);
    out[i] = reuse;
  }
  for (const { r, i } of fresh) {
    const base = baseSlug(r.name, r.iso, r.fallback);
    let slug = base;
    for (let n = 2; taken.has(slug) || retired.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    out[i] = slug;
  }
  return out;
}
