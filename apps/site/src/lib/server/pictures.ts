/** Every source is pictured through its carrier, so an Android source shows its carrier's logo too. */

import { brandLogo, brandNames, carrierLogo, type LogoSlug } from "#lib/carrierlogos.ts";
import type { ListedCarrier } from "@carrier-explode/db/d1";
import { sourceKey, sourceOf, type Carrier, type SourceKey, type SourceRef } from "@carrier-explode/schema/types";
import type { Picture } from "#lib/types.ts";

/** The carrier's primary bundle first: the one its id names. */
const primaryFirst = (carrier: Pick<Carrier, "id" | "members">): readonly SourceKey[] =>
  [...carrier.members].sort((a, b) => Number(sourceOf(b).name === carrier.id) - Number(sourceOf(a).name === carrier.id));

/**
 * A bundle of another brand in the group (Bell_Virgin_ca under Bell) keeps its own logo. Otherwise the logo agrees with
 * the brand shown: the bundles' where the brand names it, else the brand's own (Orange_nl reads Odido, and shows it).
 */
function logoOf(ref: SourceRef, carrier: Pick<ListedCarrier, "id" | "name" | "members">): LogoSlug | undefined {
  const group = primaryFirst(carrier);
  const own = carrierLogo([sourceKey(ref)]);
  if (own !== undefined && own !== carrierLogo(group.slice(0, 1))) return own;
  const bundles = carrierLogo(group);
  return bundles !== undefined && brandNames(carrier.name, bundles) ? bundles : (brandLogo(carrier.name) ?? bundles);
}

export function pictureOf(ref: SourceRef, carrier: Pick<ListedCarrier, "id" | "name" | "iso" | "members">): Picture {
  if (ref.kind === "country") return { kind: "flag", cc: carrier.iso ?? undefined };
  const slug = logoOf(ref, carrier);
  return slug === undefined ? { kind: "initials", brand: carrier.name } : { kind: "logo", slug };
}
