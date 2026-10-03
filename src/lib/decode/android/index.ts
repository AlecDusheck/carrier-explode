/**
 * Android carrier settings decoder: Google's CarrierSettings / CarrierList
 * protobufs as plain JSON (./types.ts), plus CarrierConfigManager docs for
 * their config keys. Self-contained: imports only the binary helpers; no
 * SvelteKit, Workers or Node APIs, so it runs in browsers too.
 */

export type * from "./types.ts";
export {
  decodeCarrierSettings, decodeMultiCarrierSettings, splitMultiCarrierSettings,
  type SplitMultiCarrierSettings,
} from "./carrier-settings.ts";
export { decodeCarrierList } from "./carrier-list.ts";
export { ProtobufError } from "./wire.ts";
export { configDoc, type ConfigDoc, type ConfigType } from "./docs.ts";
