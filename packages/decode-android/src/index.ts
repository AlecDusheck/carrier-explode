/** Google CarrierSettings / CarrierList protobufs as JSON, CarrierConfigManager docs for their keys, and the formats of their structured values. */

export type * from "./types.ts";
export { decodeCarrierSettings, splitMultiCarrierSettings } from "./carrier-settings.ts";
export { decodeCarrierList } from "./carrier-list.ts";
export { MissingFieldError } from "./errors.ts";
export { configDoc, type ConfigDoc, type ConfigType } from "./docs.ts";
export { ACCESS_NETWORKS, NET_CAPABILITIES, NR_STATES, readConfigValue } from "./config-values.ts";
export type * from "./config-values.ts";
