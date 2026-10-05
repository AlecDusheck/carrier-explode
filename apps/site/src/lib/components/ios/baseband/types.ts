/** Shapes the modem package page's sections receive, as the queries return them. */

import type { getBaseband, getModemPackages } from "#lib/api/apple.remote.ts";

export type Baseband = Awaited<ReturnType<typeof getBaseband>>;
export type ImageModems = Awaited<ReturnType<typeof getModemPackages>>;
export type ImageModem = ImageModems["modems"][number];
