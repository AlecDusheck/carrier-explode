/** Whether a phone has a 5G radio, as its own settings show: no table of models. */

/** The phones some settings configure, and those of them they configure for 5G. */
export interface RadioEvidence {
  readonly configured: ReadonlySet<string>;
  readonly fiveG: ReadonlySet<string>;
}

/** A phone lacks 5G when settings configure it and none for 5G; one no settings cover is not judged, and keeps its 5G features. */
export const has5GBy = (e: RadioEvidence) => (device: string): boolean => !e.configured.has(device) || e.fiveG.has(device);
