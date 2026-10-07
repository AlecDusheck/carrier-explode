import { error } from "@sveltejs/kit";
import { isReleasePlatform, type ReleasePlatform } from "@carrier-explode/schema/types";
import { PLATFORM_NAMES } from "#lib/platforms.ts";

/** Only the platforms read from OS images have builds. */
export const load = ({ params }): { readonly platform: ReleasePlatform } => {
	if (!isReleasePlatform(params.platform))
		error(
			404,
			`${PLATFORM_NAMES[params.platform]} has no builds of its own: its settings come from the OTA feed.`,
		);
	return { platform: params.platform };
};
