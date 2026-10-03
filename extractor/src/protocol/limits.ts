/**
 * Body sizes for r2.internal. Container-to-Worker requests go through an
 * outbound handler whose body limit is not documented; Workers' own request
 * limit is 100 MB on most plans, so that is assumed. Measure on a real deploy
 * before raising (README: "Limits to test").
 */

const MiB = 1024 * 1024;

/** Largest single PUT the handler accepts. */
export const MAX_PUT = 96 * MiB;
/** Bodies above this go multipart. */
export const MULTIPART_THRESHOLD = 64 * MiB;
/** Every part but the last is exactly this size (R2 requires equal parts, at least 5 MiB). */
export const PART_SIZE = 32 * MiB;
