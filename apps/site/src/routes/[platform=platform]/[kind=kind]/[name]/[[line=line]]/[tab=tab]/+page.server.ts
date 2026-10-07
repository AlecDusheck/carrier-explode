import { redirect } from "@sveltejs/kit";
import { refOf, verOf } from "#lib/at.ts";
import { MAIN_LINE, versionPath } from "@carrier-explode/schema/types";
import { resolvePage } from "#lib/server/catalog.ts";

/** A tab without a version is the line head's (`/countries/ios/Germany/alerts`); a URL without a line keeps naming none. */
export const load = async ({ params, url }) => {
	const r = await resolvePage(verOf(params));
	redirect(
		307,
		`${versionPath(refOf(params), { line: params.line ?? MAIN_LINE, slug: r.entry.slug })}/${params.tab}${url.search}`,
	);
};
