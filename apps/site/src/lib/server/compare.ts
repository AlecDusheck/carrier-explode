/** One diff for /compare and the Changes tabs: two sources of one family natively, across families concept by concept. */

import { error } from "@sveltejs/kit";
import { decoderFamily, parseSourceKey, type DecoderFamily } from "@carrier-explode/schema/types";
import type { Ver } from "#lib/types.ts";
import * as android from "./android/settings";
import * as apple from "./apple/bundle";
import * as cross from "./cross";

/** A version, and the variant of it one phone sees: on Apple, that phone's override file. */
export interface Side extends Ver {
  readonly variant?: string;
}

interface Natives {
  readonly apple: apple.NativeComparison;
  readonly android: android.AndroidChanges;
}

export type NativeComparison<F extends DecoderFamily = DecoderFamily> = { [K in F]: { readonly by: "native"; readonly family: K } & Natives[K] }[F];

export type Comparison = NativeComparison | ({ readonly by: "concepts" } & cross.CrossComparison);

/** Each family's own diff; without `a`, `b` against the version before it. */
const NATIVE: { readonly [F in DecoderFamily]: (a: Side | null, b: Side, path: string | undefined) => Promise<Natives[F]> } = {
  apple: apple.getComparison,
  android: (a, b) => (a === null ? android.getAndroidChanges(b) : android.getAndroidComparison(a, b)),
};

function familyOf(s: Side): DecoderFamily {
  const ref = parseSourceKey(s.source);
  if (!ref) error(400, `Not a source key: ${s.source}`);
  return decoderFamily(ref.platform);
}

const native = async <F extends DecoderFamily>(family: F, a: Side | null, b: Side, path: string | undefined): Promise<NativeComparison<F>> =>
  ({ by: "native", family, ...(await NATIVE[family](a, b, path)) });

export async function getComparison(a: Side | null, b: Side, path?: string): Promise<Comparison> {
  const family = familyOf(b);
  if (a !== null && familyOf(a) !== family) return { by: "concepts", ...(await cross.getCrossComparison(a, b)) };
  return native(family, a, b, path);
}
