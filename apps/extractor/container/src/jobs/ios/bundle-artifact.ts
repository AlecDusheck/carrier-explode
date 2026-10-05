/** An image bundle as an artifact: where it sits in an iPhone image, and its deterministic .ipcc with the decoder's content id. */

import { sha256Hex } from "@carrier-explode/binary";
import { bundleVersion, contentId, openIpcc, packIpcc, type UnpackedBundle } from "@carrier-explode/decode-ios";
import { sourceKey, sourceOf, type AppleArtifact, type SourceKey, type SourceKind } from "@carrier-explode/schema/types";
import type { Origin } from "@carrier-explode/storage";

/** The kinds of bundle an IPSW holds a directory of (BUNDLE_DIRS). */
export type BundleKind = Exclude<SourceKind, "default">;

export const BUNDLE_DIRS = {
  carrier: "/System/Library/Carrier Bundles/iPhone",
  country: "/System/Library/CountryBundles/iPhone",
} as const satisfies Record<BundleKind, string>;

export interface BundleRef {
  readonly kind: BundleKind;
  readonly name: string;
}

export const bundleSource = (b: BundleRef): SourceKey<"ios"> => sourceKey({ platform: "ios", ...b });

export function bundleRef(key: SourceKey): BundleRef {
  const { platform, kind, name } = sourceOf(key);
  if (platform !== "ios" || kind === "default") throw new Error(`${key}: not an iOS carrier or country bundle`);
  return { kind, name };
}

export const imageOrigin = (b: BundleRef, release: string, device: string): Origin => ({
  kind: "image",
  release,
  device,
  path: `${BUNDLE_DIRS[b.kind]}/${b.name}.bundle`,
});

export interface PackedBundle {
  readonly bytes: Uint8Array;
  readonly artifact: AppleArtifact;
}

export async function packBundle(b: UnpackedBundle): Promise<PackedBundle> {
  const version = bundleVersion(b);
  if (version === undefined) throw new Error(`${b.name}.bundle: no CFBundleVersion in Info.plist`);
  const bytes = packIpcc(b);
  const [sha, cid] = await Promise.all([sha256Hex(bytes), contentId(openIpcc(bytes))]);
  return { bytes, artifact: { sha, version, size: bytes.length, cid } };
}
