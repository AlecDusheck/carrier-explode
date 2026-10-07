/**
 * A carrier pack: one sales code's conf/ (configs/carriers/single/<code>/conf) and its IMS operator, as a zip whose
 * bytes depend on these alone, so firmwares shipping both unchanged share one pack.
 */

import { unzipSync, zipSync, type Zippable } from "fflate";
import { decodeCarrierFeature, decodeCscFeature, type CarrierFeature, type CscFeature } from "./features.ts";
import { decodeCustomer, type Customer } from "./customer.ts";
import { decodeImsOperator, type ImsOperator } from "./ims.ts";
import { decodeOmcInfo, type OmcInfo } from "./omc-info.ts";
import { decodeOmcText } from "./omc-text.ts";

export const PACK_FILES = {
	omcInfo: "omc.info",
	customer: "customer.xml",
	cscFeature: "system/cscfeature.xml",
	carrierFeature: "system/customer_carrier_feature.json",
	/** Not in conf/: the IMS service's entry for the pack's operator. */
	ims: "imsservice/operator.json",
} as const;

export class PackError extends Error {
	override name = "PackError";
}

/** The DOS epoch: a zip entry's time is part of its bytes, and a pack's content must not depend on when it was read. */
const EPOCH = new Date(1980, 0, 1);

/** `files`: conf/'s, by path under it; `ims`: the pack's operator in the firmware's IMS service, null for none. */
export function packOmc(files: ReadonlyMap<string, Uint8Array>, ims: ImsOperator | null): Uint8Array {
	if (files.has(PACK_FILES.ims)) throw new PackError(`conf/ has a ${PACK_FILES.ims} of its own`);
	const all = new Map([...files, [PACK_FILES.ims, new TextEncoder().encode(JSON.stringify(ims))]]);
	const zippable: Zippable = {};
	for (const path of [...all.keys()].toSorted()) {
		const bytes = all.get(path);
		if (bytes !== undefined) zippable[path] = [bytes, { mtime: EPOCH, level: 9 }];
	}
	return zipSync(zippable);
}

export interface Pack {
	/** Every file, by its path under conf/, and PACK_FILES.ims. */
	readonly files: ReadonlyMap<string, Uint8Array>;
	readonly omcInfo: OmcInfo;
	readonly ims: ImsOperator | null;
	readonly customer?: Customer;
	readonly cscFeature?: CscFeature;
	readonly carrierFeature?: CarrierFeature;
}

export function openOmc(zip: Uint8Array): Pack {
	const files = new Map(Object.entries(unzipSync(zip)));
	const text = (path: string): string | undefined => {
		const bytes = files.get(path);
		return bytes === undefined ? undefined : decodeOmcText(bytes);
	};
	const info = text(PACK_FILES.omcInfo);
	if (info === undefined) throw new PackError(`a pack without ${PACK_FILES.omcInfo}`);
	const customer = text(PACK_FILES.customer);
	const cscFeature = text(PACK_FILES.cscFeature);
	const carrierFeature = text(PACK_FILES.carrierFeature);
	const ims = files.get(PACK_FILES.ims);
	if (ims === undefined) throw new PackError(`a pack without ${PACK_FILES.ims}`);
	return {
		files,
		omcInfo: decodeOmcInfo(info),
		ims: decodeImsOperator(ims),
		...(customer === undefined ? {} : { customer: decodeCustomer(customer) }),
		...(cscFeature === undefined ? {} : { cscFeature: decodeCscFeature(cscFeature) }),
		...(carrierFeature === undefined ? {} : { carrierFeature: decodeCarrierFeature(carrierFeature) }),
	};
}
