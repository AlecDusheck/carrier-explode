/** The SIMs a Samsung carrier pack is for: omc.info's carrierList, the rules Samsung's own CSC selection reads. */

import { gidHex, type OmcCarrier } from "@carrier-explode/decode-samsung";
import { simMatcher, uniqueSims } from "../sims.ts";
import type { SimMatcher } from "../types.ts";

const matcherOf = (c: OmcCarrier): SimMatcher | undefined => {
	const mccmnc = `${c.mcc}${c.mnc}`;
	return simMatcher({
		mccmnc,
		gid1: gidHex(c),
		gid2: c.gid2,
		spn: c.spn,
		// The network subset: the IMSI digits right after the network code.
		imsiPrefix: c.subsetCode === undefined ? undefined : `${mccmnc}${c.subsetCode}`,
		iccidPrefix: c.iccid,
	});
};

export const packSims = (carriers: readonly OmcCarrier[]): SimMatcher[] =>
	uniqueSims(carriers.flatMap((c) => matcherOf(c) ?? []));
