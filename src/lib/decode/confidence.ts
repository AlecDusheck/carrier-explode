/** How sure a decoded name or meaning is: read from code or a spec, inferred from a consistent pattern, or guessed from names and values. */
export type Confidence = "high" | "med" | "low";

/** A confidence, or "unknown" where nothing names the thing at all. */
export type ConfidenceOrUnknown = Confidence | "unknown";
