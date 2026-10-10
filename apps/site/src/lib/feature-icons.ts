/** Feature badges: `static/features/<name>.svg`. */

import { asset } from "$app/paths";
import type { SvgName } from "./asset-names.ts";

export type FeatureIcon = SvgName<"features">;

export const featureIcon = (name: FeatureIcon): string => asset(`features/${name}.svg`);

/** As a CSS image, for a badge that paints its icon behind its tone. */
export const featureIconImage = (name: FeatureIcon): string => `url("${featureIcon(name)}")`;
