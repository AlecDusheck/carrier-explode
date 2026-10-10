import { matrixMarkdown } from "#lib/components/matrix/markdown.ts";
import { NO_PHONE } from "#lib/components/matrix/view.ts";
import { featureModels, featurePhone, getFeatureMatrix } from "#lib/server/features.ts";

/** The features matrix in Markdown, by the page's own query: a separate address, so a cache keyed by URL keeps both. */
export async function GET({ url }): Promise<Response> {
	const [models, phone] = await Promise.all([
		featureModels(),
		featurePhone(url.searchParams.get("phone") ?? undefined, undefined),
	]);
	const body =
		phone === null
			? `# Carrier features\n\n${NO_PHONE}\n`
			: matrixMarkdown(await getFeatureMatrix(phone.code), models, url);
	return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
