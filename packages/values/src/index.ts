/**
 * Decoded values of any platform, compared: one canonical text, a structural diff and dotted versions. Imports nothing,
 * so every decoder and the schema can use it.
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
export { compareDotted, versionSegments } from "./versions.ts";
