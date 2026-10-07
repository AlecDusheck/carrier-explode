/** Every carrier source is pictured through its carrier, so an Android source shows its carrier's logo too. */

import type { carrierOf } from "@carrier-explode/db";
import { countryName } from "@carrier-explode/schema";
import { brandLogo, brandNames, carrierLogo, type LogoSlug } from "#lib/carrierlogos.ts";
import { sourceKey, sourceOf, type SourceKey, type SourceRef } from "@carrier-explode/schema/types";
import type { Picture } from "#lib/types.ts";

/** What a source's picture is read from: its carrier, with every source linked into it. */
export type PicturedCarrier = Pick<
	NonNullable<Awaited<ReturnType<typeof carrierOf>>>,
	"id" | "name" | "members"
>;

/** The carrier's primary bundle first: the one its id names. */
const primaryFirst = (carrier: PicturedCarrier): readonly SourceKey[] =>
	carrier.members.toSorted(
		(a, b) => Number(sourceOf(b).name === carrier.id) - Number(sourceOf(a).name === carrier.id),
	);

/**
 * A bundle of another brand in the group (Bell_Virgin_ca under Bell) keeps its own logo. Otherwise the logo agrees with
 * the brand shown: the bundles' where the brand names it, else the brand's own (Orange_nl reads Odido, and shows it).
 */
function logoOf(ref: SourceRef, carrier: PicturedCarrier): LogoSlug | undefined {
	const group = primaryFirst(carrier);
	const own = carrierLogo([sourceKey(ref)]);
	if (own !== undefined && own !== carrierLogo(group.slice(0, 1))) return own;
	const bundles = carrierLogo(group);
	return bundles !== undefined && brandNames(carrier.name, bundles)
		? bundles
		: (brandLogo(carrier.name) ?? bundles);
}

/** A country bundle by its country's flag; a source the link step has given no carrier yet by its own name. */
export function pictureOf(ref: SourceRef, carrier: PicturedCarrier | null, cc: string | null): Picture {
	if (ref.kind === "country") return { kind: "flag", cc: cc ?? undefined };
	if (carrier === null) return { kind: "initials", brand: ref.name };
	const slug = logoOf(ref, carrier);
	return slug === undefined ? { kind: "initials", brand: carrier.name } : { kind: "logo", slug };
}

/** What people call a source: its carrier's name, a country bundle's country, else its own name. */
export const brandOf = (ref: SourceRef, carrierName: string | null, cc: string | null): string =>
	carrierName ?? (ref.kind === "country" && cc !== null ? countryName(cc) : undefined) ?? ref.name;
