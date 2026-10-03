/**
 * A phone's back, measured from its maker's product images. x and widths are
 * fractions of the body's width, y and heights of its height.
 */

export type Color = `#${string}`;

/** A raised or inset part of the back, drawn in list order. */
export type Module =
  /** A rounded rectangle: a camera bump or a square module. `radius` is a fraction of the body's width. */
  | { readonly kind: "plate"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly radius: number; readonly color: Color }
  /** A rectangle with fully rounded ends: an inset camera bar or a lens window. */
  | { readonly kind: "pill"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: Color }
  /** A bar running edge to edge: a full-width camera bar or plateau. */
  | { readonly kind: "band"; readonly y: number; readonly h: number; readonly color: Color };

/** A circle's centre and diameter. */
export type Circle = readonly [x: number, y: number, d: number];

/** A flash, or a sensor drawn as a dark dot: lidar, laser autofocus, temperature. */
export type Extra = readonly ["flash" | "sensor", ...Circle];

export interface PhoneShape {
  /** Height over width, from the official dimensions. */
  readonly aspect: number;
  /** Corner radius, a fraction of the width. */
  readonly radius: number;
  readonly color: Color;
  readonly modules: readonly Module[];
  readonly lenses: readonly Circle[];
  readonly extras: readonly Extra[];
}
