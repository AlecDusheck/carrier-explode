/** A scope for the tests: phones out since October 2020, a cutover on 2026-10-05, Galaxy S and Z Flip since 2025. */

import type { Scope } from "../src/scope.ts";

const CUTOVER = "2026-10-05";

export const SCOPE: Scope = {
	ios: {
		devices: { releasedSince: "2020-10" },
		everythingSince: CUTOVER,
		backfill: "releases",
		minMajor: 18,
	},
	android: { devices: { releasedSince: "2020-10" }, everythingSince: CUTOVER, backfill: "quarterly" },
	samsung: {
		families: ["Galaxy S", "Galaxy Z Flip"],
		exclude: [" FE"],
		releasedSince: "2025-01",
		majors: 3,
		builds: "all",
	},
	appleOta: { ios: "all", ipados: "current", watchos: "current" },
};
