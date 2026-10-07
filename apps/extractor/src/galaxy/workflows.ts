/** One Galaxy firmware: its CSC and CP members in Worker steps, its AP member's IMS service in the container, then the release. */

import * as v from "valibot";

import { PIPELINES } from "../pipelines.ts";
import { containerStep, doStep, finish, STEP, UnitWorkflow, type UnitRun } from "../unit.ts";
import type { IndexMessage } from "../indexing.ts";
import { apJob, cp, csc, release } from "./build.ts";

export class GalaxyBuildWorkflow extends UnitWorkflow {
	protected async extract(payload: unknown, r: UnitRun): Promise<readonly IndexMessage[]> {
		const fw = v.parse(PIPELINES["galaxy-build"].params, payload);
		const cscText = await doStep(r.step, "csc", STEP, () => csc(fw, r.unit));
		const cpText = await doStep(r.step, "cp", STEP, () => cp(fw, r.unit));
		const apText = await containerStep(r, "ap", apJob(fw, cscText));
		return finish(r, "release", async () => {
			await release(fw, cscText, cpText, apText, r.unit);
			return [{ kind: "release", release: { platform: "samsung", id: [fw.build] } }];
		});
	}
}
