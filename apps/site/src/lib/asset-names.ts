/** The SVG files of a `static/` directory, by name, from the asset manifest: a name with no file is a type error. */

import { assets } from "$app/manifest";
import type { AssetPath } from "$app/types";

type Named<Dir extends string, P> = P extends `${Dir}/${infer S}.svg`
	? S extends `${string}/${string}`
		? never
		: S
	: never;

export type SvgName<Dir extends string> = Named<Dir, AssetPath>;

export function svgNames(dir: string): ReadonlySet<string> {
	const prefix = `${dir}/`;
	return new Set(
		assets.flatMap(({ path }) => {
			const name =
				path.startsWith(prefix) && path.endsWith(".svg") ? path.slice(prefix.length, -".svg".length) : "";
			return name && !name.includes("/") ? [name] : [];
		}),
	);
}
