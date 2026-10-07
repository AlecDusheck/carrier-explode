/**
 * Qualcomm modem configuration decoder (MCFG, NV/EFS, policyman, modem databases, PRL, SSGCCS, carrier selection) over
 * the unwrapped item stream of a Pixel MBN or an Apple package. No SvelteKit or Workers imports.
 */

export {
	CONFIDENCES,
	CONFIDENCES_OR_UNKNOWN,
	type Confidence,
	type ConfidenceOrUnknown,
} from "./confidence.ts";
export {
	isZlibStart,
	itemPaths,
	type McfgImage,
	mcfgItemData,
	mcfgSetting,
	type McfgSetting,
	type McfgTrailer,
	type McfgTrailerSummary,
	parseMcfg,
	scanModemConfigs,
	summarizeTrailer,
	trailerField,
} from "./mcfg.ts";
export {
	annotateNv,
	CCM_FLAG_BYTES,
	CCM_ITEMS,
	decodeNvPrl,
	describeNv,
	type NvInfo,
	type NvPrl,
	type NvType,
} from "./nv.ts";
export {
	itemLayout,
	type ItemLayout,
	layoutSize,
	type NvFields,
	type NvLayout,
	readLayout,
} from "./layouts.ts";
export {
	type AmprGroup,
	bandList,
	type ComboComponent,
	type ComboStats,
	comboStats,
	type ComboType,
	parseAmprNs,
	parseBandCombos,
	parseCombo,
	parsePolicyXml,
	type PolicyNode,
	walkPolicy,
	type XmlRefs,
	xmlRefs,
} from "./policy.ts";
export { describePolicyAttr, describePolicyElement } from "./policyman.ts";
export {
	type ArfcnRange,
	decodeModemEfs,
	type MccScanEntry,
	type MdbHeader,
	parseMcc2Arfcn,
	parsePlmnFeatures,
	type PlmnFeatures,
	plmnFromKey,
	readMdb,
} from "./mdb.ts";
export { decodePrl, describePrl, type PrlAcqRecord, type PrlDecoded, type PrlSysRecord } from "./prl.ts";
export { parseSsgccs, type SsgccsConfig, type SsgccsLine } from "./ssgccs.ts";
export {
	pairSelection,
	parseSelectionDb,
	SELECTION_DB_PATH,
	SELECTION_MATCHERS,
	type SelectionMatcher,
	type SelectionRecord,
	type SelectionRule,
} from "./selection.ts";
