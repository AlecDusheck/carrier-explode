/** The daily dataset archive's date, digest and size. */

import { query } from "$app/server";
import { datasetFacts } from "#lib/server/dataset.ts";

export const getDataset = query(datasetFacts);
