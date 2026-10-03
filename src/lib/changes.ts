/**
 * Which differences between two bundles are routine: present in every rebuild or copy whatever
 * the settings, so a diff can count them in one place instead of listing each. Only differences
 * that cannot carry a setting are routine; a translation whose text changed is not.
 */

import type { FileDiff } from "#lib/decode/index.ts";

/** Keys of Info.plist and version.plist that only stamp the build. */
const VERSION_KEYS = new Set(["CFBundleVersion", "CFBundleShortVersionString", "BuildVersion", "SourceVersion"]);

export type RoutineReason = "signatures" | "version" | "translations" | "per-phone";

export const ROUTINE_LABEL: Record<RoutineReason, string> = {
  signatures: "signature",
  version: "version number only",
  translations: "translation added or removed",
  "per-phone": "per-phone file, compared by phone above",
};

/**
 * Why a file's difference is routine, or undefined when it may matter. `perPhone`: the page
 * compares override files phone by phone elsewhere, so they need not be listed here too.
 */
export function routineReason(f: FileDiff, perPhone = false): RoutineReason | undefined {
  if (f.path.startsWith("signatures/")) return "signatures";
  if (/\.lproj\/locversion\.plist$/.test(f.path)) return "version";
  // Image copies carry no version.plist; one side having it is the copy, not the settings.
  if (f.path === "version.plist" && f.kind !== "changed") return "version";
  if (/^(Info|version)\.plist$/.test(f.path) && f.kind === "changed" && f.rows.length && f.rows.every((r) => VERSION_KEYS.has(r.path)))
    return "version";
  if ((f.kind === "added" || f.kind === "removed") && (f.path.includes(".lproj/") || f.path.endsWith(".loctable"))) return "translations";
  if (perPhone && f.path.startsWith("overrides_")) return "per-phone";
  return undefined;
}
