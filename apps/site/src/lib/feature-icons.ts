/** Feature badges: `static/features/<name>.svg`, and `static/features/dark/<name>.svg` drawn for a dark surface. */

import { asset } from "$app/paths";
import type { SvgName } from "./asset-names.ts";

export type FeatureIcon = SvgName<"features">;

type Surface = "light" | "dark";

export const featureIcon = (name: FeatureIcon, surface: Surface): string =>
	asset(surface === "light" ? `features/${name}.svg` : `features/dark/${name}.svg`);

/** As a CSS image, for a badge that paints its icon behind its tone. */
export const featureIconImage = (name: FeatureIcon, surface: Surface): string =>
	`url("${featureIcon(name, surface)}")`;
