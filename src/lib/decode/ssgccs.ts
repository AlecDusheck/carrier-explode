/**
 * SSGCCS: the modem's fake base station (IMSI catcher) detection and
 * countermeasures, configured by /SSGCCS/ssgccs_config.txt and
 * ssgccs_int_config.txt ("KEY: v, v, …" lines). Field names come from the
 * modem image's key strings, debug formats and log text (qdsp6sw.mbn:
 * ssgccs_task.c, ssgccs_utility.c); the parser itself is compressed, so each
 * name carries a confidence. Self-contained, no dependencies.
 */

export type SsgccsConfidence = "high" | "med" | "low" | "unknown";

export interface SsgccsField {
  name: string;
  value: string;
  confidence: SsgccsConfidence;
}

export interface SsgccsLine {
  key: string;
  /** What the line configures. */
  title: string;
  fields: SsgccsField[];
  confidence: SsgccsConfidence;
  raw: string;
}

export interface SsgccsConfig {
  lines: SsgccsLine[];
  /** ACTIVE_PLMN_LIST: "ALL", or the networks the feature applies to. */
  activePlmns?: string[];
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
const CUSTOM: Array<[string, SsgccsConfidence]> = [
  ["Mode", "med"], ["Countermeasure threshold", "med"], ["Alert threshold", "med"], ["Hostile threshold", "med"], ["Filter", "med"],
];
// qdsp6sw.mbn: format "%s: %li, %li, %li, %li, %li, %li%c" (enable, five numbers, action word)
const RATS: Record<string, string> = { GERAN: "GSM", GSM: "GSM", WCDMA: "WCDMA", LTE: "LTE", NR: "NR" };

function ratField(value: string, i: number, n: number): SsgccsField {
  if (i === 0) return { name: "Enabled", value, confidence: "low" };
  if (i === n - 1 && /^[A-Z]/.test(value)) return { name: "Action", value, confidence: "low" };
  return { name: `Parameter ${i}`, value, confidence: "unknown" };
}

/** Both files' lines; unknown keys keep their values as numbered fields. */ // bbcfg.mbn: /SSGCCS/ssgccs_config.txt, /SSGCCS/ssgccs_int_config.txt
export function parseSsgccs(...texts: string[]): SsgccsConfig {
  const out: SsgccsConfig = { lines: [] };
  for (const text of texts) {
    for (const raw of text.replace(/\0+$/, "").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*:\s*(.*?)\s*$/.exec(raw);
      if (!m) continue;
      const [, key, rest] = m;
      const values = rest.split(",").map((s) => s.trim()).filter((s) => s !== "");
      if (key === "ACTIVE_PLMN_LIST") {
        out.activePlmns = rest.split(/[\s,]+/).filter(Boolean);
        out.lines.push({ key, title: "Networks it runs on", fields: [{ name: "Networks", value: out.activePlmns.join(" "), confidence: "high" }], confidence: "high", raw: raw.trim() });
        continue;
      }
      const line = (title: string, confidence: SsgccsConfidence, fields: SsgccsField[]) =>
        out.lines.push({ key, title, fields, confidence, raw: raw.trim() });
      if (key === "CUSTOM") {
        line("Detection thresholds", "med", values.map((value, i) => ({ name: CUSTOM[i]?.[0] ?? `Field ${i + 1}`, value, confidence: CUSTOM[i]?.[1] ?? "unknown" })));
      } else if (RATS[key]) {
        line(`${RATS[key]} settings`, "low", values.map((value, i) => ratField(value, i, values.length)));
      } else {
        line(key, "unknown", values.map((value, i) => ({ name: `Field ${i + 1}`, value, confidence: "unknown" })));
      }
    }
  }
  return out;
}
