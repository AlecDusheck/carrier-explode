/** How Android canonical names read: `tmobile_us` is tmobile in the US; `20404GID1=2801` names a SIM rule. */

import { countryName, isoForMcc } from "../countries.ts";

/** `tmobile_us` -> "us"; only a real ISO code counts (`_zz`, `_satellite` do not). */
function suffixIso(canonical: string): string | undefined {
	const cc = /_([a-z]{2})$/.exec(canonical)?.[1];
	return cc !== undefined && countryName(cc) !== undefined ? cc : undefined;
}

/** The name's suffix, else the MCC a rule-named canonical starts with. */
export function androidIso(canonical: string): string[] {
	const named = suffixIso(canonical);
	if (named !== undefined) return [named];
	const digits = /^\d{5,6}/.exec(canonical)?.[0];
	const byName = digits === undefined ? undefined : isoForMcc(digits);
	return byName === undefined ? [] : [byName];
}

/** others.pb names a carrier it has no name for by carrier_list.pb's spelling of the SIM rule that selects it. */
const RULE_NAME = /^\d{5,6}(?:(?:SPN|IMSI|GID1|ICCID)=.+)?$/;

export const isRuleNamed = (canonical: string): boolean => RULE_NAME.test(canonical);

/** carrier_name_string when set, else the canonical name without its country suffix. */
export function androidDisplay(canonical: string, carrierNameString: string | undefined): string {
	if (carrierNameString !== undefined) return carrierNameString;
	return suffixIso(canonical) === undefined ? canonical : canonical.replace(/_[a-z]{2}$/, "");
}
