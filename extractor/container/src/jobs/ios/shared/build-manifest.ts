/**
 * An IPSW's BuildManifest.plist: what it is (version, build, phones) and
 * where its parts are (the filesystem image, each board's modem package).
 * Pure, for the iOS decoder package.
 */

import * as v from "valibot";

import { compareProducts, parsePlist } from "../../../../../../src/lib/decode/index.ts";

const Component = v.looseObject({ Info: v.optional(v.looseObject({ Path: v.optional(v.string()) })) });

const Schema = v.looseObject({
  ProductVersion: v.string(),
  ProductBuildVersion: v.string(),
  SupportedProductTypes: v.array(v.string()),
  BuildIdentities: v.array(
    v.looseObject({
      Info: v.looseObject({ DeviceClass: v.string(), Variant: v.optional(v.string()) }),
      Manifest: v.record(v.string(), v.unknown()),
    }),
  ),
});

export interface BuildIdentity {
  /** Board config, lower-case: `d93ap`. */
  readonly board: string;
  /** `Customer Erase Install (IPSW)`, `Customer Upgrade Install (IPSW)`, `Recovery Customer Install`. */
  readonly variant: string;
  /** Manifest key (`OS`, `BasebandFirmware`, `Cellular1,RTKitOS`) -> path inside the IPSW. */
  readonly paths: ReadonlyMap<string, string>;
}

export interface BuildManifest {
  readonly version: string;
  readonly build: string;
  /** iPhone product types, oldest first. */
  readonly devices: readonly string[];
  readonly identities: readonly BuildIdentity[];
}

export function parseBuildManifest(bytes: Uint8Array): BuildManifest {
  const m = v.parse(Schema, parsePlist(bytes));
  return {
    version: m.ProductVersion,
    build: m.ProductBuildVersion,
    devices: [...new Set(m.SupportedProductTypes)].sort(compareProducts),
    identities: m.BuildIdentities.map((bi) => {
      const paths = new Map<string, string>();
      for (const [key, c] of Object.entries(bi.Manifest)) {
        const path = v.is(Component, c) ? c.Info?.Path : undefined;
        if (path) paths.set(key, path);
      }
      return { board: bi.Info.DeviceClass.toLowerCase(), variant: bi.Info.Variant ?? "", paths };
    }),
  };
}

/**
 * The root filesystem image: the `OS` component of the install identities.
 * Since iOS 16 the dyld cache and apps moved to cryptexes (`Cryptex1,SystemOS`,
 * `Cryptex1,AppOS`), but /System/Library/Carrier Bundles and CountryBundles
 * stayed on the root volume. Recovery identities name a small recovery OS of
 * their own (250 MB on iOS 27), which has no bundles. Every install identity
 * names the same image; two different ones would mean this picture of the
 * format is wrong, so that fails.
 */
export function osImagePath(m: BuildManifest): string {
  const install = m.identities.filter((i) => !/recovery/i.test(i.variant));
  const paths = new Set(install.flatMap((i) => i.paths.get("OS") ?? []));
  const [only, ...rest] = paths;
  if (!only) throw new Error(`${m.build}: BuildManifest names no OS image`);
  if (rest.length) throw new Error(`${m.build}: BuildManifest names ${paths.size} OS images: ${[...paths].join(", ")}`);
  return only;
}

/**
 * IPSW path -> boards it is the modem package of: `BasebandFirmware`
 * (Qualcomm, Intel) or a `Cellular1,*` component (Apple C1). Not the Rose
 * (`Rap,*`) or Wi-Fi (`Wireless1,*`) ftabs, which are not modems.
 */
export function modemBoards(m: BuildManifest): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, Set<string>>();
  for (const id of m.identities) {
    for (const [key, path] of id.paths) {
      if (key !== "BasebandFirmware" && !key.startsWith("Cellular1,")) continue;
      const boards = out.get(path) ?? new Set<string>();
      boards.add(id.board);
      out.set(path, boards);
    }
  }
  return new Map([...out].map(([p, b]) => [p, [...b].sort()]));
}
