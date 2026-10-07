/** Sources (a carrier, country or default settings file of one platform), their versions, and each version decoded. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
	copiesOf,
	entriesOf,
	selectedBy,
	sourceList,
	type ListedSource,
	type OrderedCopy,
} from "@carrier-explode/db";
import { baseSource, canonicalLine, head, lineOf, linesOf } from "@carrier-explode/schema";
import {
	isReleasePlatform,
	KIND_SEGMENT,
	parseSourceKey,
	SEGMENT_KIND,
	shipsKind,
	type KindSegment,
	type Platform,
	type SourceKind,
	type SourceRef,
} from "@carrier-explode/schema/types";
import { fail, router, type ApiContext, type ApiEnv } from "../context.ts";
import { pageQuery, paged, STRING_KEY, windowOf } from "../page.ts";
import { budget } from "../rate.ts";
import {
	settingsSchema,
	sourcePageSchema,
	sourceSchema,
	versionPageSchema,
	versionSchema,
} from "../shapes.ts";
import {
	carrierRef,
	locate,
	profileOf,
	selected,
	versionAt,
	type AtVersion,
	type StoredProfile,
	type Located,
} from "../versions.ts";
import {
	ERRORS,
	fieldsParam,
	isoParam,
	json,
	lineParam,
	NO_QUERY,
	platformParam,
	searchParam,
	slugOf,
	versionParam,
} from "./common.ts";

const onList = z.object({
	platform: platformParam,
	kind: z.enum(KIND_SEGMENT).openapi({ description: "`carriers`, `countries` (Apple only) or `defaults`." }),
});
const ofSource = onList.extend({
	name: z.string().min(1).max(200).openapi({
		description: "The platform's own name for it: `ATT_US`, `att_us`, a sales code.",
		example: "ATT_US",
	}),
});
const ofVersion = ofSource.extend({ version: versionParam });

/** The kind a list or source URL names, if its platform ships it. */
function kindOn(platform: Platform, segment: KindSegment): SourceKind {
	const kind = SEGMENT_KIND[segment];
	if (!shipsKind(platform, kind)) throw fail(404, `${platform} ships no ${segment}.`);
	return kind;
}

const refOf = (p: z.output<typeof ofSource>): SourceRef => ({
	platform: p.platform,
	kind: kindOn(p.platform, p.kind),
	name: p.name,
});

const summary = (s: ListedSource) => ({
	key: s.key,
	name: s.name,
	carrier: carrierRef(s),
	updated: s.updated,
});

/** The version a URL names, pinning the answer when the URL names it by slug. */
async function atVersion(
	c: ApiContext,
	p: z.output<typeof ofVersion>,
	line: string | undefined,
): Promise<AtVersion & { readonly at: Located }> {
	const at = await locate(c, refOf(p));
	const slug = slugOf(p.version);
	c.set("pinned", slug !== undefined);
	return { ...versionAt(at, line, slug), at };
}

/** The version of the base layer a source is read over (a Pixel's default.pb), on its newest device's line. */
async function baseOf(c: ApiContext, { ref, row, order }: Located) {
	const key = baseSource(ref.platform);
	if (key === null || row.baseSha === null) return null;
	const base = parseSourceKey(key);
	if (base === undefined) throw new Error(`${key}: not a source key`);
	const timeline = await entriesOf(c.var.db, key);
	const at = canonicalLine(base, timeline, row.baseSha, order);
	const entry = timeline.find((e) => e.line === at?.line && e.slug === at.slug);
	if (entry === undefined) throw new Error(`${ref.name}: its base ${row.baseSha} is no version of ${key}`);
	return { source: key, line: entry.line, slug: entry.slug, version: entry.version };
}

/** A copy as answers name what shipped it. */
function shipped(copy: OrderedCopy, platform: Platform) {
	if (copy.kind === "ota") {
		const { url, version, published } = copy.file;
		return { kind: "ota" as const, url, version, published, os: copy.os };
	}
	if (!isReleasePlatform(platform))
		throw new Error(`${platform} has no builds, yet build ${copy.release.id} ships it`);
	const { id, version, released } = copy.release;
	return { kind: "build" as const, platform, id, version, released };
}

export const sources: OpenAPIHono<ApiEnv> = router();

sources.openapi(
	createRoute({
		method: "get",
		path: "/{platform}/{kind}",
		operationId: "listSources",
		tags: ["Sources"],
		summary: "One platform's sources of one kind, by native name",
		middleware: [budget("base")],
		request: {
			params: onList,
			query: z
				.object({
					...pageQuery,
					q: searchParam
						.optional()
						.openapi({ description: "Part of its native name or its carrier's name, in any case." }),
					country: isoParam
						.optional()
						.openapi({ description: "Only sources its head or its carrier places in this country." }),
				})
				.strict(),
		},
		responses: { ...json(sourcePageSchema, "A page of sources, by name."), ...ERRORS },
	}),
	async (c) => {
		const { platform, kind } = c.req.valid("param");
		const { q, country, ...page } = c.req.valid("query");
		const of = kindOn(platform, kind);
		const filter = { q: q ?? null, country: country ?? null };
		return c.json(
			await paged(
				c,
				page,
				STRING_KEY,
				(w) => sourceList(c.var.db, platform, of, w, filter),
				(s) => s.name,
				summary,
			),
			200,
		);
	},
);

sources.openapi(
	createRoute({
		method: "get",
		path: "/{platform}/{kind}/{name}",
		operationId: "getSource",
		tags: ["Sources"],
		summary:
			"A source: its carrier, lines of versions, the SIM rules that select it, and the layer it is read over",
		middleware: [budget("base")],
		request: { params: ofSource, query: NO_QUERY },
		responses: { ...json(sourceSchema, "The source."), ...ERRORS },
	}),
	async (c) => {
		const at = await locate(c, refOf(c.req.valid("param")));
		const { ref, key, row, timeline, order } = at;
		const lines = linesOf(ref, timeline, order).flatMap((l) => {
			const newest = head(ref, timeline, order, l);
			return newest === undefined
				? []
				: [{ line: l, versions: lineOf(timeline, l).length, head: newest.slug }];
		});
		const [rules, base] = await Promise.all([selectedBy(c.var.db, row.headSha, key), baseOf(c, at)]);
		return c.json({ ...summary(row), lines, selectedBy: rules, base }, 200);
	},
);

sources.openapi(
	createRoute({
		method: "get",
		path: "/{platform}/{kind}/{name}/versions",
		operationId: "listVersions",
		tags: ["Sources"],
		summary: "The versions on one of a source's lines, newest first",
		middleware: [budget("base")],
		request: { params: ofSource, query: z.object({ ...pageQuery, line: lineParam.optional() }).strict() },
		responses: { ...json(versionPageSchema, "A page of versions."), ...ERRORS },
	}),
	async (c) => {
		const { ref, key, timeline, order } = await locate(c, refOf(c.req.valid("param")));
		const { line, ...page } = c.req.valid("query");
		const newest = head(ref, timeline, order, line);
		if (!newest) throw fail(404, `${key} has no line ${line ?? ""}.`);
		const entries = lineOf(timeline, newest.line);
		return c.json(
			await paged(
				c,
				page,
				STRING_KEY,
				(w) => Promise.resolve(windowOf(entries, (e) => e.slug, w)),
				(e) => e.slug,
				(e) => e,
			),
			200,
		);
	},
);

sources.openapi(
	createRoute({
		method: "get",
		path: "/{platform}/{kind}/{name}/versions/{version}",
		operationId: "getVersion",
		tags: ["Sources"],
		summary:
			"A version, decoded into the platform-neutral model (identity, APNs, concepts, variants), with every build and download that shipped it",
		middleware: [budget("bundle")],
		request: {
			params: ofVersion,
			query: z.object({ line: lineParam.optional(), fields: fieldsParam }).strict(),
		},
		responses: { ...json(versionSchema, "The version."), ...ERRORS },
	}),
	async (c) => {
		const { line, fields } = c.req.valid("query");
		const v = await atVersion(c, c.req.valid("param"), line);
		const { ref } = v.at;
		const [copies, profile] = await Promise.all([
			copiesOf(c.var.db, v.key, ref.platform),
			profileOf(c, v.key, v.entry.sha),
		]);
		const carried = copies
			.filter((x) => x.line === v.line && x.sha === v.entry.sha && x.version === v.entry.version)
			.map((x) => shipped(x, ref.platform));
		return c.json(
			{
				key: v.key,
				line: v.line,
				entry: v.entry,
				previous: v.previous?.slug ?? null,
				shipped: carried,
				profile: selected(profile, fields),
			},
			200,
		);
	},
);

sources.openapi(
	createRoute({
		method: "get",
		path: "/{platform}/{kind}/{name}/versions/{version}/settings",
		operationId: "getVersionSettings",
		tags: ["Sources"],
		summary: "A version's native settings, every one decoded",
		middleware: [budget("bundle")],
		request: {
			params: ofVersion,
			query: z
				.object({
					line: lineParam.optional(),
					prefix: z.string().min(1).max(200).optional().openapi({
						description: "Only settings whose key path starts with it.",
						example: "config:carrier_volte",
					}),
				})
				.strict(),
		},
		responses: { ...json(settingsSchema, "The settings, by key path."), ...ERRORS },
	}),
	async (c) => {
		const { line, prefix } = c.req.valid("query");
		const v = await atVersion(c, c.req.valid("param"), line);
		const { raw } = await profileOf(c, v.key, v.entry.sha);
		const settings: StoredProfile["raw"] =
			prefix === undefined
				? raw
				: Object.fromEntries(Object.entries(raw).filter(([k]) => k.startsWith(prefix)));
		return c.json({ key: v.key, line: v.line, slug: v.entry.slug, settings }, 200);
	},
);
