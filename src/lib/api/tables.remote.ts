import * as v from "valibot";
import { query } from "$app/server";
import * as data from "$lib/server/data";

export const getCbs = query(() => data.getCbs());
export const getPlmn = query(() => data.getPlmn());

export const scanKey = query(
  v.object({
    path: v.string(),
    file: v.string(),
    scope: v.string(),
    limit: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120)),
  }),
  (a) => data.scanKey(a.path, a.file, a.scope, a.limit),
);
