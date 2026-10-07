/** The iOS build and Apple OTA Workflows. */

import * as v from "valibot";

import type { IndexMessage } from "../indexing.ts";
import { PIPELINES } from "../pipelines.ts";
import { containerStep, finish, otaSnapshot, UnitWorkflow, type UnitRun } from "../unit.ts";
import { merge } from "./build.ts";
import { ipswJob } from "./ipsw.ts";
import { otaFile, otaPlan } from "./ota.ts";

/** One iOS build: each in-scope IPSW in the container, one after another (a build holds one container at a time), then the merge. */
export class IosBuildWorkflow extends UnitWorkflow {
	protected async extract(payload: unknown, r: UnitRun): Promise<readonly IndexMessage[]> {
		const build = v.parse(PIPELINES["ios-build"].params, payload);
		const ipsws: string[] = [];
		for (const ipsw of build.ipsws)
			ipsws.push(await containerStep(r, `ipsw ${ipsw.device}`, ipswJob(build, ipsw, r.unit)));
		return finish(r, "merge", async () => {
			await merge(build, ipsws, r.unit);
			return [{ kind: "release", release: { platform: "ios", id: [build.build] } }];
		});
	}
}

/** One snapshot of Apple's OTA carrier manifest: each file it lists that is new or listed differently, then its pointer; its routes, then its files, queued. */
export class AppleOtaWorkflow extends UnitWorkflow {
	protected extract(payload: unknown, r: UnitRun): Promise<readonly IndexMessage[]> {
		const { manifest } = v.parse(PIPELINES["apple-ota"].params, payload);
		return otaSnapshot(r, "apple", manifest, {
			plan: (u) => otaPlan(manifest, u),
			file: (url, u) => otaFile(manifest, url, u),
			first: [{ kind: "routes", manifest }],
		});
	}
}
