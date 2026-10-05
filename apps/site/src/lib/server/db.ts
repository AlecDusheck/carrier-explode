/** The index: one D1 session per request, so reads go to the nearest replica and stay in order within the request. */

import { env } from "cloudflare:workers";
import { indexDb, type IndexDb } from "@carrier-explode/db/d1";
import { perRequest } from "./cache";

export const db = perRequest(async (): Promise<IndexDb> => indexDb(env.DB.withSession()));
