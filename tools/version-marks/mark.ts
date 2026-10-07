/** A release's mark: a 24-unit rounded tile with its numeral, after the vendor's version branding. */

type Color = `#${string}`;

/** Gradient direction across the tile: from (x1, y1) to (x2, y2). */
type Direction = readonly [x1: number, y1: number, x2: number, y2: number];

/** Colours evenly spaced along the direction. */
type Stops = readonly [Color, ...Color[]];

export type Mark =
	/** A gradient numeral on a white tile. */
	| { readonly on: "white"; readonly dir: Direction; readonly stops: Stops }
	/** A filled tile (one stop is a flat fill) with the numeral in `ink`. */
	| { readonly on: "tile"; readonly dir: Direction; readonly stops: Stops; readonly ink: Color }
	/** A tile whose numeral is heavier and translucent, like Apple's Liquid Glass marks. */
	| { readonly on: "glass"; readonly dir: Direction; readonly stops: Stops; readonly ink: Color };

/** One vendor's marks by major version; a version without one gets the plain tile. */
export interface Family {
	readonly dir: string;
	/** The fallback's file name: the plain tile without a numeral. */
	readonly fallback: string;
	readonly font: string;
	readonly marks: Readonly<Record<number, Mark>>;
	/** Majors drawn on the plain tile with their numeral. */
	readonly plain: readonly number[];
}
