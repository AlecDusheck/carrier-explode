/** omc.info: a carrier pack's version, model and catalog, and the SIM rules that select it (`carrierList`). */

import { child, childrenNamed, childText, parseXml, XmlError, type XmlElement } from "./xml.ts";

/** One SIM rule. `gid` is GID1, written in hex, or in decimal when `codeType` is DEC; `subsetCode` follows the network code in the IMSI. */
export interface OmcCarrier {
	readonly mcc: string;
	readonly mnc: string;
	readonly networkName?: string;
	readonly spn?: string;
	readonly codeType?: string;
	readonly gid?: string;
	readonly gid2?: string;
	readonly subsetCode?: string;
	readonly iccid?: string;
}

export interface OmcInfo {
	/** `SAOMC_SM-S931B_OXM_SFR_16_0007`. */
	readonly version: string;
	readonly model: string;
	/** What the pack carries and each part's edition: customerEdition, cscfeatureVersion, carrierListVersion, … */
	readonly catalog: Readonly<Record<string, string>>;
	readonly carriers: readonly OmcCarrier[];
}

/** A GID written in decimal (codeType DEC: Virgin Media IE's 117) is the byte 75 in hex, as the SIM holds it. */
export const gidHex = (c: OmcCarrier): string | undefined =>
	c.gid === undefined
		? undefined
		: c.codeType === "DEC"
			? Number(c.gid).toString(16).padStart(2, "0")
			: c.gid;

const FIELDS = [
	"networkName",
	"spn",
	"codeType",
	"gid",
	"gid2",
	"subsetCode",
	"iccid",
] as const satisfies readonly (keyof OmcCarrier)[];

function carrierOf(e: XmlElement): OmcCarrier {
	const mcc = childText(e, "mcc");
	const mnc = childText(e, "mnc");
	if (mcc === undefined || mnc === undefined) throw new XmlError("an omc.info carrier without mcc or mnc");
	const qualifiers: Partial<Record<(typeof FIELDS)[number], string>> = {};
	for (const f of FIELDS) {
		const v = childText(e, f);
		if (v !== undefined) qualifiers[f] = v;
	}
	return { mcc, mnc, ...qualifiers };
}

export function decodeOmcInfo(xml: string): OmcInfo {
	const root = parseXml(xml);
	const version = childText(root, "version");
	const model = child(root, "model");
	const modelName = model === undefined ? undefined : childText(model, "name");
	if (version === undefined || modelName === undefined)
		throw new XmlError("omc.info without a version or model");
	const catalog = child(root, "catalog");
	const list = child(root, "carrierList");
	return {
		version,
		model: modelName,
		catalog: Object.fromEntries((catalog?.children ?? []).map((c) => [c.name, c.text])),
		carriers: list === undefined ? [] : childrenNamed(list, "carrier").map(carrierOf),
	};
}

/** `SAOMC_SM-S931B_OXM_SFR_16_0007` → `16.0007`: the Android release, then the pack's revision. */
export function omcVersion(info: OmcInfo): string {
	const m = /_(\d+)_(\d+)$/.exec(info.version);
	if (!m) throw new XmlError(`omc.info version ${info.version} does not end in _<android>_<revision>`);
	return `${m[1]}.${m[2]}`;
}
