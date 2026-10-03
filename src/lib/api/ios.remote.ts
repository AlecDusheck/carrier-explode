/** iOS native views: a bundle at a version, its files, diffs, phones and modem defaults. */

import * as v from "valibot";
import { query } from "$app/server";
import type { DecodedFile } from "#lib/decode/index.ts";
import type { CbsRow } from "#lib/types.ts";
import * as ios from "#lib/server/ios.ts";
import { at, device, index, packageId, path, pinned } from "./schemas";

export const getBundle = query(v.object(at), (a): Promise<ios.IosBundle> => ios.getBundle(a.source, a.slug));
export const getFile = query(v.object({ ...pinned, path }), (a): Promise<DecodedFile> => ios.getFile(a.source, a.slug, a.path));
export const getAlerts = query(v.object(pinned), (a): Promise<CbsRow | null> => ios.getAlerts(a.source, a.slug));

/** One diff for /compare and the Changes tab. No `a`: against the version before `b`. */
export const getComparison = query(
  v.object({ a: v.nullable(v.object(at)), b: v.object(at), path: v.exactOptional(path) }),
  (q): Promise<ios.NativeComparison> => ios.getComparison(q.a, q.b, q.path),
);

/** A version's phone groups against what each phone had at the version compared against. */
export const getPhoneChanges = query(v.object({ ...pinned, against: v.exactOptional(v.string()) }), (a): Promise<ios.PhoneChange[] | null> =>
  ios.getPhoneChanges(a.source, a.slug, a.against));
export const getOverridePlist = query(v.object({ ...pinned, path }), (a): Promise<ios.OverridePlist | null> =>
  ios.getOverridePlist(a.source, a.slug, a.path));
export const getBundleOverrides = query(v.object(at), (a): Promise<ios.BundleOverrides | null> => ios.getBundleOverrides(a.source, a.slug));
export const getBasebandDefaults = query(v.object({ ...at, device: v.exactOptional(device) }), (a): Promise<ios.ModemDefaults> =>
  ios.getBasebandDefaults(a.source, a.slug, a.device));
export const getBasebandOverride = query(
  v.object({ ...at, id: packageId, pri: path, efs: path, i: index }),
  (a): Promise<ios.ModemOverride> => ios.getBasebandOverride(a.source, a.slug, a.id, a.pri, a.efs, a.i),
);
