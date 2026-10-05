/** Shapes the server hands to pages, kept out of #lib/server so components can name them. */

import type { LogoSlug } from "#lib/carrierlogos.ts";
import type { Platform, SourceRef, TimelineEntry } from "@carrier-explode/schema/types";

/** An ISO 3166 alpha-2 country code, as the index writes it (`us`). */
export const ISO_CODE = /^[a-z]{2}$/;

/** The names a page's head reads for the codes in its URL; null where the route names none or the index has none. */
export interface PageNames {
  /** The source's carrier as lists show it (`AT&T` for ATT_US), and its country. */
  readonly source: { readonly brand: string; readonly country: string | null } | null;
  /** A build's modem as its list shows it (`Qualcomm X80 · Mav25`), and the phones running it. */
  readonly modem: { readonly label: string; readonly phones: string } | null;
  /** The build as its release names it: `iOS 27.2 beta 2`, `Android 16 (2026-09)`. */
  readonly release: string | null;
}

/** A version as a URL names it: source, line, and version (absent: the line's head). */
export interface Ver {
  readonly source: string;
  readonly line?: string;
  readonly slug?: string;
}

/** A source, and a version of it on one of its lines: what every page under /<platform>/<kind>/<name>[/<line>]/<version>/ is about. */
export interface At {
  readonly ref: SourceRef;
  /** An Android device, or a model-specific Apple bundle's product type; null for Apple's main line. */
  readonly line: string | null;
  /** The timeline slug. */
  readonly version: string;
}

/** How a source is pictured: its carrier's logo, its country's flag, or the initials of its brand. */
export type Picture =
  | { readonly kind: "logo"; readonly slug: LogoSlug }
  | { readonly kind: "flag"; readonly cc: string | undefined }
  | { readonly kind: "initials"; readonly brand: string };

/** A timeline entry as pages show it, named by where it came from. */
export interface Version extends TimelineEntry {
  readonly platform: Platform;
  /** The one label the version strip uses. */
  readonly label: string;
  /** The OS version its mark shows. */
  readonly icon: string | undefined;
}

/** What a version's tab body receives: the page and version, and the file a tab that takes one is on ("" for none). */
export interface TabProps {
  readonly at: At;
  readonly path: string;
}
