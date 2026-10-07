/** SBP id (MediaTek's modem operator id, `OPnn` on the Android side) to operator name. */

/**
 * Most trusted first: usp, UspServiceImpl.java `sOperatorMapInfo` (github.com/s1204IT/DchaLibraries-CT3); wod, wod_optr.conf
 * (github.com/goldfish07/cloud_upload); wodSony, an older copy (github.com/SonyMTKDev); pixel, Pixel 11 /etc/mdota/custom names.
 */
type SbpSource = "usp" | "wod" | "wodSony" | "pixel";

/** Names as their source spells them; the most trusted source wins. Test and vendor ids (999, 1001, 1003, 24576) are left out. */
const SBP_OPERATORS = [
	[1, "CMCC", "usp"],
	[2, "CU", "usp"],
	[3, "Orange", "usp"],
	[5, "TMO EU", "usp"],
	[6, "Vodafone", "usp"],
	[7, "AT&T", "usp"],
	[8, "TMO US", "usp"],
	[9, "CT", "usp"],
	[11, "H3G", "usp"],
	[12, "Verizon", "usp"],
	[15, "Telefonica", "usp"],
	[16, "EE", "usp"],
	[17, "DoCoMo", "usp"],
	[18, "Reliance", "usp"],
	[19, "Telstra", "usp"],
	[20, "Sprint", "usp"],
	[50, "Softbank", "usp"],
	[100, "CSL", "usp"],
	[101, "PCCW", "usp"],
	[102, "SMT", "usp"],
	[103, "SingTel", "usp"],
	[104, "Starhub", "usp"],
	[105, "AMX", "usp"],
	[106, "3HK", "usp"],
	[107, "SFR", "usp"],
	[108, "TWN", "usp"],
	[109, "CHT", "usp"],
	[110, "FET", "usp"],
	[111, "VODAFONE_INDIA", "wod"],
	[112, "TelCel", "usp"],
	[113, "Beeline", "usp"],
	[114, "KT", "usp"],
	[115, "SKT", "usp"],
	[116, "U+", "usp"],
	[117, "Smartfren", "usp"],
	[118, "YTL", "usp"],
	[119, "Natcom", "usp"],
	[120, "Claro", "usp"],
	[121, "Bell", "usp"],
	[122, "AIS", "usp"],
	[124, "APTG", "usp"],
	[125, "DTAC", "usp"],
	[126, "Avea", "usp"],
	[127, "Megafon", "usp"],
	[128, "DNA", "usp"],
	[129, "KDDI", "usp"],
	[130, "TIM", "usp"],
	[131, "TrueMove", "usp"],
	[132, "VIVO", "wod"],
	[134, "Elisa", "wod"],
	[135, "MTS", "wod"],
	[136, "ENTEL", "wod"],
	[137, "Tele2", "wod"],
	[140, "MTN_ZA", "wod"],
	[141, "CELLC", "wod"],
	[143, "Turkcell", "wod"],
	[145, "CRICKET", "wod"],
	[146, "Etisalat", "wod"],
	[147, "AIRTEL", "wod"],
	[149, "CMHK", "wod"],
	[150, "Swisscom", "wod"],
	[152, "Optus/Australia", "wod"],
	[153, "VHA/Australia", "wod"],
	[154, "Telia", "wod"],
	[155, "Digi", "wod"],
	[156, "Telenor", "wod"],
	[158, "ZAIN", "wod"],
	[159, "STC", "wod"],
	[161, "Play", "wod"],
	[162, "Freedom", "wod"],
	[163, "Dialog", "wod"],
	[165, "Sunrise", "wod"],
	[171, "WOM/Chile", "wod"],
	[175, "TDC", "wodSony"],
	[178, "SMART_CAMBODIA", "wod"],
	[179, "Newroz", "wod"],
	[181, "Telkom", "wodSony"],
	[182, "Proximus", "wodSony"],
	[183, "Personal_Argentina", "wod"],
	[185, "2degrees", "wod"],
	[186, "IDEA", "wod"],
	[188, "A1", "wod"],
	[189, "UMOBILE", "wod"],
	[198, "Sberbank", "wod"],
	[203, "NOS", "wod"],
	[211, "C&W Panama", "wod"],
	[267, "ATT", "pixel"],
	[446, "VZW", "pixel"],
] as const satisfies readonly (readonly [number, string, SbpSource])[];

export interface SbpOperator {
	readonly sbpId: number;
	readonly name: string;
	readonly source: SbpSource;
}

const BY_ID = new Map(
	SBP_OPERATORS.map(([sbpId, name, source]): [number, SbpOperator] => [sbpId, { sbpId, name, source }]),
);

/** The operator an SBP id names, if a source names it. */
export function sbpOperator(sbpId: number): SbpOperator | undefined {
	return BY_ID.get(sbpId);
}
