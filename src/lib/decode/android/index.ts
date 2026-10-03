/** Google CarrierSettings / CarrierList protobufs as JSON, plus CarrierConfigManager docs for their keys. */

export type * from "./types.ts";
export {
  decodeCarrierSettings, decodeMultiCarrierSettings, splitMultiCarrierSettings,
  type SplitMultiCarrierSettings,
} from "./carrier-settings.ts";
export { decodeCarrierList } from "./carrier-list.ts";
export { ProtobufError } from "./wire.ts";
export { configDoc, type ConfigDoc, type ConfigType } from "./docs.ts";
