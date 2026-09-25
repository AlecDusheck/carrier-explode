/**
 * SSGCCS: the modem's fake base station (IMSI catcher) detection and
 * countermeasures, configured by /SSGCCS/ssgccs_config.txt and
 * ssgccs_int_config.txt ("KEY: v, v, …" lines). Field names come from the
 * modem image's key strings, debug formats and log text (qdsp6sw.mbn:
 * ssgccs_task.c, ssgccs_utility.c); the parser itself is compressed, so each
 * name carries a confidence.
 */

import type { ConfidenceOrUnknown } from "./confidence";

export interface SsgccsField {
  name: string;
  value: string;
  /** What an action word does. */
  meaning?: string;
  confidence: ConfidenceOrUnknown;
}

export interface SsgccsLine {
  key: string;
  /** What the line configures. */
  title: string;
  fields: SsgccsField[];
  confidence: ConfidenceOrUnknown;
  raw: string;
}

export interface SsgccsConfig {
  /** ACTIVE_PLMN_LIST is "ALL". */
  allNetworks: boolean;
  /** The networks ACTIVE_PLMN_LIST names otherwise; empty when it is absent. */
  plmns: string[];
  /** CUSTOM: the detection thresholds. */
  custom?: SsgccsLine;
  /** One line per radio technology (GERAN, WCDMA, LTE, NR). */
  rats: SsgccsLine[];
  /** Keys the firmware strings do not explain, fields numbered. */
  other: SsgccsLine[];
}

// qdsp6sw.mbn rodata: cell states in score order
export const SSGCCS_STATES = ["SAFE", "SAFE_NEAR_ALERT", "ALERT", "ALERT_NEAR_HOSTILE", "HOSTILE"];

// qdsp6sw.mbn rodata: countermeasure action words
export const SSGCCS_ACTIONS: Record<string, string> = {
  ALL: "every countermeasure",
  BAR: "bar the cell",
  D2BTIMER: "start the D2B timer",
  DEFAULT: "the built-in countermeasure",
  DEPRIOR: "deprioritise the cell",
  NONE: "no countermeasure",
};

// qdsp6sw.mbn: log "Threshold Values{CTR-M,ALT,HST,FIL}: {%u,%u,%u,%d}", debug print "%s:%u,%u,%u,%u,%d"
const CUSTOM: Array<[string, ConfidenceOrUnknown]> = [
  ["Mode", "med"], ["Countermeasure threshold", "med"], ["Alert threshold", "med"], ["Hostile threshold", "med"], ["Filter", "med"],
];
// qdsp6sw.mbn: format "%s: %li, %li, %li, %li, %li, %li%c" (enable, five numbers, action word)
const RATS: Record<string, string> = { GERAN: "GSM", GSM: "GSM", WCDMA: "WCDMA", LTE: "LTE", NR: "NR" };

function ratField(value: string, i: number, n: number): SsgccsField {
  if (i === 0) return { name: "Enabled", value, confidence: "low" };
  if (i === n - 1 && /^[A-Z]/.test(value)) {
    const meaning = Object.hasOwn(SSGCCS_ACTIONS, value) ? SSGCCS_ACTIONS[value] : undefined;
    return { name: "Action", value, ...(meaning ? { meaning } : {}), confidence: "low" };
  }
  return { name: `Parameter ${i}`, value, confidence: "unknown" };
}

/** Both files' lines; unknown keys keep their values as numbered fields. */ // bbcfg.mbn: /SSGCCS/ssgccs_config.txt, /SSGCCS/ssgccs_int_config.txt
export function parseSsgccs(...texts: string[]): SsgccsConfig {
  const out: SsgccsConfig = { allNetworks: false, plmns: [], rats: [], other: [] };
  for (const text of texts) {
    for (const line of text.replace(/\0+$/, "").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const [, key, rest] = m;
      if (key === "ACTIVE_PLMN_LIST") {
        const listed = rest.split(/[\s,]+/).filter(Boolean);
        out.allNetworks ||= listed.includes("ALL");
        out.plmns.push(...listed.filter((p) => p !== "ALL"));
        continue;
      }
      const values = rest.split(",").map((s) => s.trim()).filter((s) => s !== "");
      const raw = line.trim();
      if (key === "CUSTOM") {
        out.custom = { key, title: "Detection thresholds", confidence: "med", raw, fields: values.map((value, i) => ({ name: CUSTOM[i]?.[0] ?? `Field ${i + 1}`, value, confidence: CUSTOM[i]?.[1] ?? "unknown" })) };
      } else if (Object.hasOwn(RATS, key)) {
        out.rats.push({ key, title: `${RATS[key]} settings`, confidence: "low", raw, fields: values.map((value, i) => ratField(value, i, values.length)) });
      } else {
        out.other.push({ key, title: key, confidence: "unknown", raw, fields: values.map((value, i) => ({ name: `Field ${i + 1}`, value, confidence: "unknown" })) });
      }
    }
  }
  return out;
}
