/** Bundle versions as both platforms write them: dotted numbers (`9.1`, `72.0`, `79000000034`). Apple's OS labels, betas included, are decode-ios's compareVersions. */

const segments = (v: string): number[] =>
  v.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isNaN(n) ? -1 : n;
  });

/** Numeric by segment, a missing segment counting as 0; a segment that is not a number sorts below every number. */
export function compareDotted(a: string, b: string): number {
  const x = segments(a), y = segments(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
