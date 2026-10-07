/**
 * Views for CarrierConfig values whose format decode-android's readConfigValue knows, each imported only when a
 * page shows one. Every format has one (the mapped type checks it); a value it rejects renders raw, marked not understood.
 */

import type { ConfigFormat, ConfigFormats, DecodedConfig } from "@carrier-explode/decode-android";
import type { Lazy, Loaded } from "../../values/registry.ts";

const CONFIG_VIEWS: { readonly [F in ConfigFormat]: Lazy<{ value: ConfigFormats[F] }> } = {
	"handover-rules": () => import("./HandoverRules.svelte"),
	"retry-rules": () => import("./RetryRules.svelte"),
	"nr-icons": () => import("./NrIcons.svelte"),
	"nr-icon-timers": () => import("./NrIconTimers.svelte"),
	"nr-modes": () => import("./NrModes.svelte"),
	"signal-levels": () => import("./SignalLevels.svelte"),
	"reason-remaps": () => import("./ReasonRemaps.svelte"),
	certificates: () => import("./Certificates.svelte"),
};

export async function configView<F extends ConfigFormat>(
	d: DecodedConfig<F>,
): Promise<Loaded<{ value: ConfigFormats[F] }>> {
	const { default: View } = await CONFIG_VIEWS[d.format]();
	return { View, props: { value: d.value } };
}
