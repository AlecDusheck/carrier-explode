/** Dotted version numbers as every platform writes them: `9.1`, `72.0`, `79000000034`, `27.0.1`. */

/** Numeric segments; one that is not a number is -1, so it sorts below every real one. */
export const versionSegments = (v: string): number[] =>
	v.split(".").map((part) => {
		const n = Number.parseInt(part, 10);
		return Number.isNaN(n) ? -1 : n;
	});

/** Numeric by segment, a missing segment counting as 0. */
export function compareDotted(a: string, b: string): number {
	const x = versionSegments(a),
		y = versionSegments(b);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}
