/** Which phone each Apple board is, from the feeds' device records, and the phones a bundle file's boards are, named. */

import { deviceRecords } from "@carrier-explode/db/d1";
import { boardProducts, boardRefs, type BoardProducts } from "@carrier-explode/schema";
import type { NamedBoard, WithPhones } from "#lib/apple/phones.ts";
import { perRequest } from "../cache";
import { db } from "../db";
import { namer } from "../names";

/** What an override file's name means. */
const boardsNow = perRequest(async (): Promise<BoardProducts> => boardProducts(await deviceRecords(await db(), "apple")));

/** Files with the phones their names' boards are, each named, in one lookup. */
export async function withPhones<F extends { readonly boards?: readonly string[] }>(files: readonly F[]): Promise<Array<WithPhones<F>>> {
  const products = await boardsNow();
  const boards = files.map((f) => (f.boards === undefined ? undefined : boardRefs(f.boards, products)));
  const phone = await namer("device", boards.flatMap((b) => b?.flatMap((d) => d.product ?? []) ?? []));
  return files.map((f, i): WithPhones<F> => {
    const refs = boards[i];
    return refs === undefined ? f : { ...f, devices: refs.map((d): NamedBoard => ({ ...d, name: d.product === undefined ? d.board : phone(d.product).name })) };
  });
}
