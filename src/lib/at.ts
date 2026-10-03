/** From a page's route params to the source and version it shows. */

import { sourceKey, type Platform, type SourceRef } from "#lib/schema/types.ts";
import { SOURCE_KIND, type Kind } from "#lib/types.ts";

export interface SourceParams {
  readonly kind: Kind;
  readonly platform: Platform;
  readonly name: string;
  readonly line?: string | undefined;
  readonly version?: string | undefined;
}

export const refOf = (p: SourceParams): SourceRef => ({ platform: p.platform, kind: SOURCE_KIND[p.kind], name: p.name });

/** The query args naming the version a URL shows; without a version, the line's head. */
export const verOf = (p: SourceParams): { source: string; line?: string; slug?: string } => ({
  source: sourceKey(refOf(p)),
  ...(p.line === undefined ? {} : { line: p.line }),
  ...(p.version === undefined ? {} : { slug: p.version }),
});
