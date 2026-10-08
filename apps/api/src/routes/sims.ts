/** A SIM, looked up: every source on every platform whose head claims, or whose routing sends it, a rule the SIM satisfies. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { rulesOnPlmn } from "@carrier-explode/db";
import { ruleSpecificity, selectsSim, type SimFacts, type SimRule } from "@carrier-explode/schema";
import { parseRuleKey } from "@carrier-explode/schema/types";
import { router, type ApiEnv } from "../context.ts";
import { simMatchesSchema } from "../shapes.ts";
import { carrierRef } from "../versions.ts";
import { ERRORS, json } from "./common.ts";

const HEX = /^[0-9A-Fa-f]{1,40}$/;
const DIGITS = /^\d{1,22}$/;

export const sims: OpenAPIHono<ApiEnv> = router().openapi(
	createRoute({
		method: "get",
		path: "/sims",
		operationId: "lookUpSim",
		tags: ["SIMs"],
		summary: "Every source a SIM selects on every platform, most specific rule first",
		request: {
			query: z
				.object({
					mccmnc: z
						.string()
						.regex(/^\d{5,6}$/)
						.openapi({ description: "MCC and MNC, 5 or 6 digits.", example: "310260" }),
					gid1: z
						.string()
						.regex(HEX)
						.optional()
						.openapi({ description: "Group ID 1, hex.", example: "6D38" }),
					gid2: z.string().regex(HEX).optional().openapi({ description: "Group ID 2, hex." }),
					spn: z.string().min(1).max(64).optional().openapi({ description: "Service provider name." }),
					imsi: z.string().regex(DIGITS).optional(),
					iccid: z.string().regex(DIGITS).optional(),
				})
				.strict(),
		},
		responses: {
			...json(
				simMatchesSchema,
				"Each source and the rule that selects it; one source can match by several rules.",
			),
			...ERRORS,
		},
	}),
	async (c) => {
		const { mccmnc, gid1, gid2, spn, imsi, iccid } = c.req.valid("query");
		const sim: SimFacts = {
			mccmnc,
			...(gid1 === undefined ? {} : { gid1 }),
			...(gid2 === undefined ? {} : { gid2 }),
			...(spn === undefined ? {} : { spn }),
			...(imsi === undefined ? {} : { imsi }),
			...(iccid === undefined ? {} : { iccid }),
		};
		const rows = await rulesOnPlmn(c.var.db, mccmnc, iccid ?? null);
		const matched = rows.flatMap((r) => {
			const rule: SimRule | undefined = parseRuleKey(r.matcher);
			return rule !== undefined && selectsSim(rule, sim)
				? [{ row: r, specificity: ruleSpecificity(rule) }]
				: [];
		});
		const items = matched
			.toSorted((x, y) => y.specificity - x.specificity || x.row.source.localeCompare(y.row.source))
			.map(({ row }) => ({
				source: row.source,
				carrier: carrierRef(row),
				rule: row.matcher,
				via: row.via,
			}));
		return c.json({ items }, 200);
	},
);
