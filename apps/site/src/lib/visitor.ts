/** The visitor's phone, read in the browser after a page has drawn, so no page reads the visitor on the server. */

import type { Platform } from "@carrier-explode/schema/types";
import { getPixelOfModel } from "#lib/api/sources.remote.ts";
import type { FeaturePhone } from "#lib/server/features.ts";
import { browserDevice } from "./device";

export interface VisitorDevice {
	readonly platform: Platform | null;
	/** The source line the visitor's phone is, when its platform names one by the model it reports. */
	readonly line: string | null;
}

const none = async (): Promise<null> => null;

/** An Apple device never says its model; a Pixel's reported model (`Pixel 9 Pro`) names its codename; a Galaxy's is its line. */
const LINE_OF_MODEL = {
	ios: none,
	ipados: none,
	watchos: none,
	android: async (model) => getPixelOfModel(model),
	// A Galaxy's line is its model number.
	samsung: async (model) => model,
} as const satisfies Record<Platform, (model: string) => Promise<string | null>>;

export async function visitorDevice(): Promise<VisitorDevice> {
	const { platform, model } = await browserDevice();
	return {
		platform,
		line: platform === null || model === undefined ? null : await LINE_OF_MODEL[platform](model),
	};
}

/** The visitor's own among the Features phones; one that names no line, or one the site lacks, means its platform's newest covered phone. */
export const visitorPhone = (
	phones: readonly FeaturePhone[],
	{ platform, line }: VisitorDevice,
): FeaturePhone | undefined =>
	phones.find((p) => p.code === line) ?? phones.find((p) => p.platform === platform && p.covered);
