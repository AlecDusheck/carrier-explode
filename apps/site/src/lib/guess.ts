/**
 * The site's best guess of the visitor: their phone, country and carrier as the strings pickers, lists and searches
 * show, so a page selects each by plain match. The server makes it (`server/visitor.ts`); pages read it (`visitor.ts`).
 */

import { networkCarrier, tradeWords, type Carrier } from "@carrier-explode/networks";
import type { PhoneVariant } from "@carrier-explode/schema";
import type { Platform, SourceKey } from "@carrier-explode/schema/types";
import type { Device } from "./device";
import { fold } from "./names";
import { openingVariant, type ModelChoice } from "./phones";
import { PLATFORM_ORDER } from "./platforms";

export interface VisitorGuess {
	readonly platform: Platform;
	/** A device's name (`Galaxy S25 (SM-S931B)`, `iPhone 18 Pro Max (US)`), as variants and phone rows carry it. */
	readonly phone: string | null;
	/** ISO code (`us`), as rows, phone variants and the feed name countries. */
	readonly country: string | null;
	/** A carrier's name as lists show it (`AT&T`). */
	readonly carrier: string | null;
	/** The carrier's main bundle on the platform, which Compare opens. */
	readonly bundle: SourceKey | null;
	/** The carrier is the network's the visitor is on, not a stand-in for their country. */
	readonly fromNetwork: boolean;
}

/** A platform's carrier source as its list shows it. */
interface Listed {
	readonly key: SourceKey;
	readonly name: string;
	readonly brand: string;
	readonly carrier: string | null;
}

/** A phone with feature states. `covered`: as the features pages judge it. */
interface StatedPhone {
	readonly code: string;
	readonly name: string;
	readonly covered: boolean;
}

/** What a guess is made from: the request, the browser's report, and the guessed platform's lists in the site's order. */
export interface GuessInput {
	readonly device: Device;
	readonly country: string | null;
	/** The AS organisation of the network a phone's request came from. */
	readonly network: string | null;
	readonly carriers: readonly Carrier[];
	/** The platform's carriers in the visitor's country as its country page orders them, then the US's. */
	readonly local: readonly Listed[];
	readonly fallback: readonly Listed[];
	/** The platform's phones with feature states, newest first, and the same grouped as pickers offer them. */
	readonly phones: readonly StatedPhone[];
	readonly models: readonly ModelChoice[];
}

/** A desktop is shown what the menu leads it to. */
export const guessPlatform = (d: Device): Platform => d.platform ?? PLATFORM_ORDER[0];

/** The phone the browser names (a Galaxy by its model number, a Pixel by its name); else, of the platform's newest covered phone, the variant made for the country. */
function guessPhone({ device, country, phones, models }: GuessInput): string | null {
	const own = phones.find((p) => p.code === device.model || p.name === device.model);
	if (own) return own.name;
	const newest = phones.find((p) => p.covered);
	const model = models.find((m) => m.variants.some((v) => v.code === newest?.code));
	return (model && openingVariant(model, country)?.name) ?? newest?.name ?? null;
}

/** A carrier's main bundle: the one its carrier is named after (ATT_US, not ATT_NR_US), else its first. */
const mainOf = (entries: readonly Listed[]): Listed | undefined =>
	entries.find((e) => e.carrier !== null && fold(e.name) === fold(e.carrier)) ?? entries[0];

/** A list's first carrier, where several share its name the one with the most bundles there. */
function firstOf(list: readonly Listed[]): Listed | undefined {
	const named = list.filter((e) => e.brand === list[0]?.brand);
	const count = (e: Listed): number => list.filter((o) => o.carrier === e.carrier).length;
	const top = named.toSorted((a, b) => count(b) - count(a))[0];
	return mainOf(top?.carrier == null ? named : list.filter((e) => e.carrier === top.carrier));
}

/** The network's carrier where the platform lists it in the visitor's country; else that country's first; else the US's first. */
export function bestGuess(input: GuessInput): VisitorGuess {
	const { country, network, carriers, local, fallback } = input;
	const theirs = networkCarrier(network, carriers, country, tradeWords(carriers));
	const onNetwork = mainOf(local.filter((e) => e.carrier === theirs?.id));
	const bundle = onNetwork ?? firstOf(local) ?? firstOf(fallback);
	return {
		platform: guessPlatform(input.device),
		phone: guessPhone(input),
		country,
		carrier: bundle?.brand ?? null,
		bundle: bundle?.key ?? null,
		fromNetwork: onNetwork !== undefined,
	};
}

/** The guessed phone among a picker's phones. */
export const guessedVariant = (models: readonly ModelChoice[], g: VisitorGuess): PhoneVariant | undefined =>
	models.flatMap((m) => m.variants).find((v) => v.name === g.phone);
