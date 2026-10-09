/** A fling's physics on one axis: release velocity from recent samples, friction, and a rubber band past the edges. */

export interface Sample {
	readonly t: number;
	readonly p: number;
}

/** Only the last stretch of a drag says how fast the finger left. */
const WINDOW_MS = 100;

/** px/ms over the samples within the window before the last; 0 when the finger had stopped. */
export function releaseVelocity(samples: readonly Sample[]): number {
	const last = samples.at(-1);
	if (!last) return 0;
	const first = samples.find((s) => last.t - s.t <= WINDOW_MS) ?? last;
	const dt = last.t - first.t;
	return dt > 0 ? (last.p - first.p) / dt : 0;
}

/** [min, max]: how far the content may move; max is 0, min is the viewport less the content, never above 0. */
export type Bounds = readonly [min: number, max: number];

/** Past an edge, the content follows the finger less and less. */
export function rubber(p: number, [min, max]: Bounds, size: number): number {
	const over = p > max ? p - max : p < min ? p - min : 0;
	if (over === 0) return p;
	const resisted = (1 - 1 / ((Math.abs(over) * 0.55) / size + 1)) * size;
	return (p > max ? max : min) + Math.sign(over) * resisted;
}

const FRICTION_PER_MS = 0.995;
const SPRING_PER_MS = 0.012;
const REST_V = 0.01;

export interface Motion {
	readonly p: number;
	readonly v: number;
}

/** One frame of `dt` ms: coast and slow, or, past an edge, spring back to it. */
export function step({ p, v }: Motion, [min, max]: Bounds, dt: number): Motion {
	const edge = p > max ? max : p < min ? min : null;
	if (edge !== null) {
		const k = 1 - Math.pow(1 - SPRING_PER_MS, dt);
		const next = p + (edge - p) * k + v * dt * 0.25;
		return Math.abs(next - edge) < 0.5 ? { p: edge, v: 0 } : { p: next, v: v * Math.pow(0.9, dt / 16) };
	}
	const decayed = v * Math.pow(FRICTION_PER_MS, dt);
	return { p: p + decayed * dt, v: Math.abs(decayed) < REST_V ? 0 : decayed };
}

export const atRest = (m: Motion, [min, max]: Bounds): boolean => m.v === 0 && m.p >= min && m.p <= max;
