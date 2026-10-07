/** Which Pixel OTAs to extract, and which Pixels and trains to ask the update service about. Pure: the checks fetch, this decides. */

import type { PipelineParams } from "../pipelines.ts";
import { pixelInScope, type DatedDevice, type Scope } from "../scope.ts";
import type { OtaBuild, OtaDevice } from "./check.ts";

export type PixelDevice = PipelineParams<"pixel-device">;

export interface Ask {
	readonly device: string;
	readonly train: string;
}

/** The first four characters of a build id, which is all the service reads of it: `CP3A`. */
export const trainOf = (build: string): string => build.slice(0, 4).toUpperCase();

/** `CP3A.260905.009` -> `260905.009`: a build's date and its number that day, which order a device's builds. */
export const recency = (build: string): string => build.slice(build.indexOf(".") + 1);

/** Each held Pixel's newest train among the builds held for it, by device: only what ingest took is asked about. */
export function asks(held: ReadonlyArray<readonly [build: string, device: string]>): Ask[] {
	const newest = new Map<string, string>();
	for (const [build, device] of held) {
		const was = newest.get(device);
		if (was === undefined || recency(build) > recency(was)) newest.set(device, build);
	}
	return [...newest]
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([device, build]) => ({ device, train: trainOf(build) }));
}

/** Newest first: by patch month, then by the build's own date and number. */
const newestFirst = (a: OtaBuild, b: OtaBuild): number =>
	b.patch.localeCompare(a.patch) || recency(b.build).localeCompare(recency(a.build));

/** The builds before the cutoff a device keeps: its newest of each train (a quarterly drop's last monthly build), or its newest alone. */
function backfill(rule: Scope["android"]["backfill"], builds: readonly OtaBuild[]): OtaBuild[] {
	const newest = builds.toSorted(newestFirst);
	if (rule === "newest") return newest.slice(0, 1);
	return [...Map.groupBy(newest, (b) => trainOf(b.build)).values()].flatMap((ofTrain) => ofTrain.slice(0, 1));
}

/** A phone, as the OTA page names it: its heading names a tablet (`Pixel Tablet`) as one. */
const isPhone = (d: OtaDevice): boolean => !/\btablet\b/i.test(d.name);

/**
 * Each in-scope Pixel phone's general OTAs (carrier and region variants left out): every one whose patch month is the
 * cutoff's or later, and the backfill rule's of the rest. Less what is held (`<build>/<device>`); oldest first.
 */
export function planPixel(
	scope: Scope,
	page: readonly OtaDevice[],
	devices: readonly DatedDevice[],
	held: ReadonlySet<string>,
): PixelDevice[] {
	const { everythingSince, backfill: rule } = scope.android;
	const since = everythingSince?.slice(0, 7) ?? null;
	const inScope = new Set(devices.filter((d) => pixelInScope(scope, d)).map((d) => d.code));
	return page
		.filter((d) => inScope.has(d.device) && isPhone(d))
		.flatMap((d) => {
			const general = d.builds.filter((b) => b.variant === undefined);
			const isNew = (b: OtaBuild): boolean => since !== null && b.patch >= since;
			return backfill(
				rule,
				general.filter((b) => !isNew(b)),
			).concat(general.filter(isNew));
		})
		.map((b): PixelDevice => ({
			build: b.build,
			version: String(Number.parseInt(b.android, 10)),
			patch: b.patch,
			device: b.device,
			url: b.url,
		}))
		.filter((p) => !held.has(`${p.build}/${p.device}`))
		.toSorted(
			(a, b) =>
				a.patch.localeCompare(b.patch) || a.build.localeCompare(b.build) || a.device.localeCompare(b.device),
		);
}
