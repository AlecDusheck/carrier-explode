/** Carrier icons: `static/carriers/<slug>.svg`, found by the brand a carrier's name gives, or by a `logo` label. */

import { svgNames, type SvgName } from "./asset-names.ts";

export type LogoSlug = SvgName<"carriers">;

const SLUGS = svgNames("carriers");

export const isLogoSlug = (s: string): s is LogoSlug => SLUGS.has(s);

const brandWords = (brand: string): string[] =>
	brand
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replaceAll("&", "")
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

/** The logo a brand names, by the longest run of its words that is one, then the rightmost (`Orange BF` is orange). */
export function brandLogo(brand: string): LogoSlug | undefined {
	const words = brandWords(brand);
	for (let n = words.length; n > 0; n--) {
		for (let at = words.length - n; at >= 0; at--) {
			const slug = words.slice(at, at + n).join("-");
			if (isLogoSlug(slug)) return slug;
		}
	}
	return undefined;
}
