/** Samsung versions: one sales code's carrier pack on one Galaxy line. */

import * as v from "valibot";
import { query } from "$app/server";
import * as samsung from "#lib/server/samsung/pack.ts";
import { path, pinned, slug } from "./schemas";

const args = v.object(pinned);

export const getSamsung = query(args, samsung.getSamsung);
export const getSamsungSettings = query(args, samsung.getSamsungSettings);
export const getSamsungApns = query(args, samsung.getSamsungApns);
export const getSamsungFile = query(v.object({ ...pinned, path }), (a) => samsung.getSamsungFile(a, a.path));
export const getSamsungChanges = query(v.object({ ...pinned, against: v.exactOptional(slug) }), (a) =>
	samsung.getSamsungChanges(a, a.against),
);
