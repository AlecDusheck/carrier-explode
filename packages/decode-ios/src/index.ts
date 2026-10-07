/**
 * iOS decoder: carrier/country bundles, plists, PRI, modem packages, Apple's OTA manifest.
 * No SvelteKit or Workers imports; runs in browsers, Workers and Node.
 */

export { isBigInt, isBlob, isDate, isJsonDict, isUid, mergeSettings, type PlistDict } from "./plist.ts";
export { type CertInfo } from "./der.ts";
export {
	type BundleFile,
	type BundleInfo,
	type CmsSignature,
	contentId,
	contentTypeOf,
	type DecodedFile,
	decodedPlist,
	decodedPri,
	decodeFile,
	deviceStem,
	type FileKind,
	isPlistKind,
	MemberError,
	type OpenedBundle,
	openIpcc,
	overrideBoards,
	overrideMvnoSet,
	type PlistKind,
} from "./bundle.ts";
export {
	bundleVersion,
	isJunk,
	packIpcc,
	type UnpackedBundle,
	type UnpackedFile,
	unpackIpcc,
} from "./ipcc.ts";
export {
	type BundleDiff,
	comparable,
	compareBundles,
	type PhonePair,
	diffKeyed,
	type FileDiff,
} from "./compare.ts";
export { flatten, flattenBundle } from "./flatten.ts";
export { describeField, describeValue, type FieldDoc, type ValueLabel } from "./fields.ts";
export { normalizeApplePng } from "./png.ts";
export { describeMessageId } from "./cbs.ts";
export { type CafInfo } from "./caf.ts";
export { type DmuKey } from "./dmu.ts";
export { type PriDecoded, type PriValue } from "./pri.ts";
export { type TriAccess, type TriDecoded, type TriField, type TriPlmnAccess } from "./tri.ts";
export {
	filterIntel,
	type IntelList,
	type IntelNode,
	type IntelTable,
	type IntelTree,
	type IntelValue,
	isIntelNode,
} from "./intel.ts";
export {
	dialectLabel,
	MODEM_SUMMARY_SCHEMA,
	type ModemCapabilities,
	modemCapabilities,
	type ModemKind,
	modemLabel,
	modemName,
	type ModemSummary,
	type PackageVendor,
	modemVendor,
} from "./modem.ts";
export { type BbcfgMeta } from "./bbcfg.ts";
export {
	type BandComboSet,
	type BasebandContainer,
	type BasebandByteFile,
	type BasebandFile,
	type BasebandImage,
	type BasebandMdb,
	type BasebandModemEfs,
	type BasebandNvBlob,
	type BasebandNvRecord,
	type BasebandSsgccs,
	type BasebandSummary,
	type BasebandTextFile,
	basebandSummary,
	BYTE_FORMATS,
	CONTENT_FORMATS,
	isTextFile,
	TEXT_FORMATS,
	type ModemConfigSummary,
	type Variant,
	variantKey,
} from "./baseband-summary.ts";
export {
	basebandComparable,
	carriedBy,
	comboTagPlmns,
	type ComboSetRow,
	mergeComboSets,
	type PriReplacement,
	priReplacements,
	priText,
} from "./baseband-views.ts";
export { type FtabSummary, ftabSummary } from "./ftab.ts";
export {
	buildIndex,
	buildMccMnc,
	buildWatchRoutes,
	type BundleRef,
	MANIFEST_URL,
	type ManifestTables,
	manifestTables,
	parseManifest,
	publishedOn,
} from "./manifest.ts";
export { type BuildManifest, modemDevices, osImagePath, parseBuildManifest } from "./build-manifest.ts";
export { byNewest, compareProducts, compareVersions, isPrerelease, newestProduct } from "./versions.ts";
