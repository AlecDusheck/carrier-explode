/** From a page's route params to the source and version it shows. */

import { SEGMENT_KIND, sourceKey, type KindSegment, type Platform, type SourceRef } from "@carrier-explode/schema/types";
import type { At, Ver } from "#lib/types.ts";

export interface SourceParams {
  readonly kind: KindSegment;
  readonly platform: Platform;
  readonly name: string;
  readonly line?: string | undefined;
  readonly version?: string | undefined;
}

export const refOf = (p: SourceParams): SourceRef => ({ platform: p.platform, kind: SEGMENT_KIND[p.kind], name: p.name });

/** The query args naming the version a URL shows; without a version, the line's head. */
export const verOf = (p: SourceParams): Ver => ({
  source: sourceKey(refOf(p)),
  ...(p.line === undefined ? {} : { line: p.line }),
  ...(p.version === undefined ? {} : { slug: p.version }),
});

/** The version a version page shows. */
export const atOf = (p: SourceParams & { readonly version: string }): At => ({
  ref: refOf(p),
  line: p.line ?? null,
  version: p.version,
});
