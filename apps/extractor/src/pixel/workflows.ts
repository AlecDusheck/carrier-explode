/** The Pixel device and Pixel OTA Workflows. */

import * as v from "valibot";

import type { IndexMessage } from "../indexing.ts";
import { PIPELINES } from "../pipelines.ts";
import { doStep, finish, normalizeSteps, otaSnapshot, STEP, UnitWorkflow, type UnitRun } from "../unit.ts";
import { items, modem, plan, release, settings } from "./device.ts";
import { otaFile, otaPlan } from "./ota.ts";

/**
 * One Pixel's OTA of one build: its modem's family, its CarrierSettings, the Shannon item table, its modem
 * configurations, each in a step of its own, then their normalizing, then the release record.
 */
export class PixelDeviceWorkflow extends UnitWorkflow {
	protected async extract(payload: unknown, r: UnitRun): Promise<readonly IndexMessage[]> {
		const d = v.parse(PIPELINES["pixel-device"].params, payload);
		const family = await doStep(r.step, "plan", STEP, () => plan(d));
		const pending = await doStep(r.step, "settings", STEP, () => settings(d, r.unit));
		if (family !== null) {
			if (family.family === "shannon")
				await doStep(r.step, "modem items", STEP, () => items(d, family.label, r.unit));
			const configs = await doStep(r.step, "modem", STEP, () => modem(d, family, r.unit));
			await normalizeSteps(r, "normalize modem", configs);
		}
		await normalizeSteps(r, "normalize settings", pending);
		return finish(r, "release", async () => [
			{ kind: "release", release: await release(d, family !== null, r.unit) },
		]);
	}
}

/** One answer set of Google's Pixel carrier-settings update service: each file it lists that is new or listed differently, then its pointer; its files queued. */
export class PixelOtaWorkflow extends UnitWorkflow {
	protected extract(payload: unknown, r: UnitRun): Promise<readonly IndexMessage[]> {
		const { snapshot } = v.parse(PIPELINES["pixel-ota"].params, payload);
		return otaSnapshot(r, "pixel", snapshot, {
			plan: (u) => otaPlan(snapshot, u.bucket),
			file: (url, u) => otaFile(snapshot, url, u),
			first: [],
		});
	}
}
