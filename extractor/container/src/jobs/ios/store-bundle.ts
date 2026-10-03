/**
 * One bundle into R2: packaged deterministically (./shared/ipcc.ts), keyed by
 * sha256 under obj/, with its content id computed by the iOS decoder itself
 * (contentId over the reopened package), so ingest and the site can never
 * disagree on it.
 */

import { contentId, openIpcc } from "../../../../../src/lib/decode/index.ts";
import { sourceKey } from "../../../../../src/lib/schema/types.ts";
import type { ObjMeta } from "../../../../../src/lib/storage/keys.ts";
import type { R2Client } from "../../job.ts";
import { bundleVersion, packIpcc, type Bundle } from "./shared/ipcc.ts";

export type BundleKind = "carrier" | "country";

/** A stored bundle as ios.ipsw outputs it and Release.sources records it. */
export interface StoredBundle {
  readonly source: string;
  readonly sha: string;
  /** CFBundleVersion. */
  readonly version: string;
  readonly size: number;
  readonly cid: string;
}

/** Every image bundle has an Info.plist with a CFBundleVersion; one without is not a bundle this understands. */
export async function storeBundle(r2: R2Client, kind: BundleKind, b: Bundle, origin: ObjMeta["origin"]): Promise<StoredBundle> {
  const version = bundleVersion(b);
  if (version === undefined) throw new Error(`${b.name}.bundle: no CFBundleVersion in Info.plist`);
  const bytes = packIpcc(b);
  const cid = await contentId(openIpcc(bytes));
  const sha = await r2.putObj(bytes, { kind: "ios.ipcc", cid, origin });
  return { source: sourceKey({ platform: "ios", kind, name: b.name }), sha, version, size: bytes.length, cid };
}
