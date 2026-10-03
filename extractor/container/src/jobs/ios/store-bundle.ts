/** One image bundle into obj/, packaged deterministically, with the decoder's own content id. */

import { contentId, openIpcc } from "../../../../../src/lib/decode/index.ts";
import { sourceKey, type AppleArtifact } from "../../../../../src/lib/schema/types.ts";
import type { R2Client } from "../../job.ts";
import { bundleVersion, packIpcc, type Bundle } from "./shared/ipcc.ts";

export type BundleKind = "carrier" | "country";

/** Where an iPhone image keeps each kind. */
export const BUNDLE_DIRS = {
  carrier: "/System/Library/Carrier Bundles/iPhone",
  country: "/System/Library/CountryBundles/iPhone",
} as const satisfies Record<BundleKind, string>;

export interface StoredBundle extends AppleArtifact {
  readonly source: string;
}

export interface ImageRef {
  readonly release: string;
  readonly device: string;
}

export async function storeBundle(r2: R2Client, kind: BundleKind, b: Bundle, image: ImageRef): Promise<StoredBundle> {
  const version = bundleVersion(b);
  if (version === undefined) throw new Error(`${b.name}.bundle: no CFBundleVersion in Info.plist`);
  const bytes = packIpcc(b);
  const cid = await contentId(openIpcc(bytes));
  const origin = { via: "image", ...image, path: `${BUNDLE_DIRS[kind]}/${b.name}.bundle` } as const;
  const sha = await r2.putObj(bytes, { kind: "apple.ipcc", cid, origin });
  return { source: sourceKey({ platform: "ios", kind, name: b.name }), sha, version, size: bytes.length, cid };
}
