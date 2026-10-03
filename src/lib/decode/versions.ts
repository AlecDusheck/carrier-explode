/**
 * Orderings Apple's numbering needs: iOS and bundle versions once betas are
 * among them, and iPhone product types by model generation. Pure, so the
 * manifest parser, the schema's timelines and the site all sort one way.
 */

// "27.2 beta 3", "26.0 RC 2": the suffix AppleDB and Apple's release notes use.
const PRERELEASE = /^(.*?)\s+(beta|rc)\s*(\d*)$/i;

/** Numeric segments; anything that is not a number sorts below every real release. */
export function versionKey(v: string): number[] {
  return v.split(".").map((p) => parseInt(p, 10)).map((p) => (Number.isNaN(p) ? -1 : p));
}

/** A prerelease ranks below its release: 27.2 beta 3 < 27.2 RC < 27.2 < 27.2.1. */
function split(v: string): [number[], number] {
  const m = PRERELEASE.exec(v);
  if (!m) return [versionKey(v), 1e6];
  const [, base = "", kind = "", n = ""] = m;
  return [versionKey(base), kind.toLowerCase() === "rc" ? 1e3 + Number(n || 0) : Number(n || 0)];
}

export function compareVersions(a: string, b: string): number {
  const [A, ra] = split(a), [B, rb] = split(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] ?? 0) - (B[i] ?? 0);
    if (d) return d;
  }
  return ra - rb;
}

export const isPrerelease = (version: string): boolean => PRERELEASE.test(version);

/** "iPhone18,1" -> [18, 1]; anything else -> [0, 0]. */
function model(id: string): [number, number] {
  const m = /(\d+),(\d+)$/.exec(id);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** Product types by generation, then by model within it: iPhone17,1 < iPhone17,5 < iPhone18,1. */
export function compareProducts(a: string, b: string): number {
  const [x, y] = [model(a), model(b)];
  return x[0] - y[0] || x[1] - y[1];
}

/** Anything that serves a set of phones: a modem package, a group of override files. */
export interface ServesPhones {
  readonly devices: ReadonlyArray<{ readonly id: string }>;
}

const newestOf = (m: ServesPhones): string => m.devices.map((d) => d.id).sort(compareProducts).at(-1) ?? "";

/** The ones serving the newest phone first. */
export const byNewest = <M extends ServesPhones>(items: readonly M[]): M[] =>
  [...items].sort((a, b) => compareProducts(newestOf(b), newestOf(a)));
