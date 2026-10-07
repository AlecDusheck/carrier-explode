/** Two versions of any two sources side by side: concepts and APNs across platforms, native settings within one family. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { compareProfiles } from "@carrier-explode/schema";
import { parseSourceKey, type SourceKey } from "@carrier-explode/schema/types";
import { router, type ApiContext, type ApiEnv } from "../context.ts";
import { budget } from "../rate.ts";
import { comparisonSchema, type Comparison } from "../shapes.ts";
import { locate, profileOf, versionAt, type AtVersion, type StoredProfile } from "../versions.ts";
import { ERRORS, json, lineParam, slugOf, sourceKeyParam, versionParam } from "./common.ts";

async function resolve(
	c: ApiContext,
	key: SourceKey,
	line: string | undefined,
	version: string | undefined,
): Promise<AtVersion & { readonly profile: StoredProfile }> {
	const ref = parseSourceKey(key);
	if (ref === undefined) throw new Error(`${key}: a checked key that does not parse`);
	const at = versionAt(await locate(c, ref), line, version === undefined ? undefined : slugOf(version));
	return { ...at, profile: await profileOf(c, at.key, at.entry.sha) };
}

const end = ({ key, line, entry }: AtVersion) => ({
	source: key,
	line,
	slug: entry.slug,
	version: entry.version,
});

export const compare: OpenAPIHono<ApiEnv> = router().openapi(
	createRoute({
		method: "get",
		path: "/compare",
		operationId: "compare",
		tags: ["Compare"],
		summary:
			"Two versions of any two sources: concepts and APNs on any platforms, and native settings when both are of one decoder family",
		middleware: [budget("bundle")],
		request: {
			query: z
				.object({
					a: sourceKeyParam,
					a_line: lineParam.optional(),
					a_version: versionParam.optional(),
					b: sourceKeyParam.openapi({ example: "android:carrier:att_us" }),
					b_line: lineParam.optional(),
					b_version: versionParam.optional(),
				})
				.strict(),
		},
		responses: { ...json(comparisonSchema, "The two versions, compared."), ...ERRORS },
	}),
	async (c) => {
		const q = c.req.valid("query");
		const [a, b] = await Promise.all([
			resolve(c, q.a, q.a_line, q.a_version),
			resolve(c, q.b, q.b_line, q.b_version),
		]);
		c.set(
			"pinned",
			[q.a_version, q.b_version].every((v) => v !== undefined && slugOf(v) !== undefined),
		);
		const comparison: Comparison = { ...compareProfiles(a.profile, b.profile), a: end(a), b: end(b) };
		return c.json(comparison, 200);
	},
);
