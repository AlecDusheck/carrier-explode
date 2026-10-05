/** Samsung Shannon modem configuration (Pixel 6–10a): vendor/firmware/carrierconfig and uecapconfig, and the modem firmware's item registry. */

export { type CarrierDb, decodeCarrierDb, type SimMatcher } from "./carrier-db.ts";
export { decodeConfseq } from "./confseq.ts";
export { type ItemDef, itemTable, ITEM_TYPES, type ItemType } from "./item-table.ts";
export { itemValue, type ItemValue } from "./item-value.ts";
export { byName, confseqCaCombinations, type ItemLookup, type LteCaComponent } from "./lte-ca.ts";
export { decodeManifest, type HardwareCondition, type Manifest, type ManifestScope } from "./manifest.ts";
export { confseqPlmnCategories, type PlmnCategory } from "./plmn-categories.ts";
export type { Plmn } from "./plmn.ts";
export { type Component, decodeUeCap } from "./uecap.ts";
export { ShannonFormatError } from "./wire.ts";
