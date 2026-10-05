/** How sure a decoded name or meaning is: read from code or a spec, inferred from a consistent pattern, or guessed from names and values. */
export const CONFIDENCES = ["high", "med", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** A confidence, or "unknown" where nothing names the thing at all. */
export const CONFIDENCES_OR_UNKNOWN = [...CONFIDENCES, "unknown"] as const;
export type ConfidenceOrUnknown = (typeof CONFIDENCES_OR_UNKNOWN)[number];
