import { datasetResponse } from "#lib/server/dataset.ts";

/** The daily dataset (wiki/datasets), kept at the edge until the next purge. */
export const GET = ({ request }): Promise<Response> => datasetResponse(request);
