/** Apple's devices as AppleDB records them: each product type's first release day and its board configs. */

import * as v from "valibot";

import type { Device } from "@carrier-explode/schema/types";

export const APPLEDB_DEVICES = "https://api.appledb.dev/device/main.json";

const DAY = /^\d{4}(-\d{2}){0,2}$/;

export const appleDbDevicesSchema = v.array(v.looseObject({
  identifier: v.array(v.string()),
  board: v.array(v.string()),
  /** A day, or one per model or colour that followed. */
  released: v.optional(v.union([v.string(), v.array(v.string())])),
}));

/** One record per product type: several AppleDB records can share one (a model, a case), so their boards merge and the earliest day wins. */
export function appleDeviceRecords(records: v.InferOutput<typeof appleDbDevicesSchema>): Device[] {
  const byCode = new Map<string, { released: string; boards: string[] }>();
  for (const r of records) {
    const [day] = [r.released ?? []].flat().filter((d) => DAY.test(d)).toSorted();
    if (day === undefined || r.board.length === 0) continue;
    for (const code of r.identifier) {
      const held = byCode.get(code);
      byCode.set(code, held === undefined
        ? { released: day, boards: [...r.board] }
        : { released: day < held.released ? day : held.released, boards: [...new Set([...held.boards, ...r.board])] });
    }
  }
  return [...byCode].map(([code, d]) => ({ code, family: "apple", ...d }));
}
