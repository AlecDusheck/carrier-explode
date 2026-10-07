/**
 * Samsung carrier packs (OMC) and the IMS service's maps, decoded. No public format exists; the layout was read from
 * Galaxy S25 firmware.
 */

export {
	type CarrierFeature,
	CarrierFeatureError,
	type CscFeature,
	decodeCarrierFeature,
	decodeCscFeature,
	type Features,
} from "./features.ts";
export { type Customer, type CustomerProfile, decodeCustomer, type ProfileHandle } from "./customer.ts";
export { decodeOmcInfo, gidHex, type OmcCarrier, type OmcInfo, omcVersion } from "./omc-info.ts";
export { decodeOmcText } from "./omc-text.ts";
export {
	IMS_FILES,
	ImsError,
	type ImsMaps,
	imsOperator,
	type ImsOperator,
	type ImsSim,
	type ImsValue,
	mnoName,
	mnoRule,
	type MnoRule,
	parseJsonc,
	readIms,
} from "./ims.ts";
export { openOmc, type Pack, PACK_FILES, PackError, packOmc } from "./pack.ts";
export {
	child,
	childrenNamed,
	childText,
	parseXml,
	XmlError,
	type XmlElement,
	xmlValue,
	type XmlValue,
} from "./xml.ts";
