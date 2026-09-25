/** Shapes the modem package page's sections receive, as the queries return them. */

import type { getBaseband, getBasebandBuilds, getModems } from "$lib/api/tables.remote";

export type Baseband = Awaited<ReturnType<typeof getBaseband>>;
export type ImageModems = Awaited<ReturnType<typeof getModems>>;
export type ImageModem = ImageModems["modems"][number];
export type BasebandBuild = Awaited<ReturnType<typeof getBasebandBuilds>>[number];
