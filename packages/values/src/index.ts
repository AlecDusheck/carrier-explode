/**
 * Decoded values of any platform, compared and looked up: one canonical text, a structural diff, and key paths
 * over flattened values. Imports nothing, so every decoder and the schema can use it.
 */

export { canonical, isRecord } from "./canonical.ts";
export {
	diffValues,
	summariseDiff,
	type DiffCounts,
	type DiffKind,
	type DiffRow,
	type PairKeys,
} from "./diff.ts";
export { lookup, lookupAll, pathPattern, type Flat } from "./paths.ts";
export { compareDotted, versionSegments } from "./versions.ts";
