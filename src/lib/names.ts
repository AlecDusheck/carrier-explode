/**
 * Names and versions, shared by the server and the page head: how a bundle
 * name reads to a person, and how iOS versions order once betas are among them.
 * No imports, so anything can use it.
 */

/* ---------------------------------------------------------------- versions */

// "27.2 beta 3", "26.0 RC 2": the suffix AppleDB and Apple's release notes use.
const PRERELEASE = /^(.*?)\s+(beta|rc)\s*(\d*)$/i;

/** Numeric segments; anything that is not a number sorts below every real release. */
export function versionKey(v: string): number[] {
  return v.split(".").map((p) => parseInt(p, 10)).map((p) => (Number.isNaN(p) ? -1 : p));
}

/** A prerelease ranks below its release: 27.2 beta 3 < 27.2 RC < 27.2 < 27.2.1. */
function split(v: string): [number[], number] {
  const m = PRERELEASE.exec(v);
  const num = versionKey(m ? m[1] : v);
  const rank = !m ? 1e6 : m[2].toLowerCase() === "rc" ? 1e3 + Number(m[3] || 0) : Number(m[3] || 0);
  return [num, rank];
}

export function compareVersions(a: string, b: string): number {
  const [A, ra] = split(a), [B, rb] = split(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] ?? 0) - (B[i] ?? 0);
    if (d) return d;
  }
  return ra - rb;
}

export const isPrerelease = (version: string) => PRERELEASE.test(version);

/** URL segment for an iOS image: ios-27.0, ios-27.2-beta-3. */
export const imageSlug = (version: string) => "ios-" + version.trim().replace(/\s+/g, "-");

/** "ios-27.2-beta-3" -> "iOS 27.2 beta 3", "ota-58.1-iPad" -> "build 58.1 (iPad)". */
export function versionLabel(slug: string): string {
  let m = /^ios-(\d+(?:\.\d+)*)((?:-(?:beta|rc)(?:-\d+)?)?)(?:-(\w+))?$/i.exec(slug);
  if (m) return `iOS ${m[1]}${m[2].replace(/-/g, " ")}${m[3] ? ` (${m[3]})` : ""}`;
  if (slug === "ota-legacy") return "legacy build";
  m = /^ota-([\d.]+)(?:-([A-Za-z]\w*))?/.exec(slug);
  if (m) return `build ${m[1]}${m[2] ? ` (${m[2]})` : ""}`;
  return slug;
}

/**
 * Which iOS an image build belongs to, from the build number alone: 24A437 is
 * iOS 27, 22G86 is iOS 18. Betas end in a lowercase letter. Only the major
 * version is certain; the letter is the minor train, not a point release.
 */
export function buildLabel(build: string): string {
  const m = /^(\d+)[A-Z]\d+([a-z])?$/.exec(build);
  if (!m) return build;
  const n = Number(m[1]);
  // iOS 18 was build 22; iOS 26 skipped ahead to build 23.
  const major = n >= 23 ? n + 3 : n - 4;
  return `iOS ${major}${m[2] ? " beta" : ""}`;
}

/* ------------------------------------------------------------------- names */

const ISO_NAMES: Record<string, string> = {
  ad:"Andorra",ae:"United Arab Emirates",af:"Afghanistan",ag:"Antigua & Barbuda",al:"Albania",am:"Armenia",ao:"Angola",ar:"Argentina",at:"Austria",au:"Australia",aw:"Aruba",az:"Azerbaijan",
  ba:"Bosnia & Herzegovina",bb:"Barbados",bd:"Bangladesh",be:"Belgium",bf:"Burkina Faso",bg:"Bulgaria",bh:"Bahrain",bi:"Burundi",bj:"Benin",bm:"Bermuda",bn:"Brunei",bo:"Bolivia",br:"Brazil",bs:"Bahamas",bt:"Bhutan",bw:"Botswana",by:"Belarus",bz:"Belize",
  ca:"Canada",cd:"DR Congo",cf:"Central African Rep.",cg:"Congo",ch:"Switzerland",ci:"Côte d'Ivoire",cl:"Chile",cm:"Cameroon",cn:"China",co:"Colombia",cr:"Costa Rica",cu:"Cuba",cv:"Cabo Verde",cw:"Curaçao",cy:"Cyprus",cz:"Czechia",
  de:"Germany",dk:"Denmark",dm:"Dominica",do:"Dominican Rep.",dz:"Algeria",
  ec:"Ecuador",ee:"Estonia",eg:"Egypt",er:"Eritrea",es:"Spain",et:"Ethiopia",
  fi:"Finland",fj:"Fiji",fo:"Faroe Islands",fr:"France",
  ga:"Gabon",gb:"United Kingdom",gd:"Grenada",ge:"Georgia",gf:"French Guiana",gh:"Ghana",gi:"Gibraltar",gl:"Greenland",gm:"Gambia",gn:"Guinea",gp:"Guadeloupe",gq:"Equatorial Guinea",gr:"Greece",gt:"Guatemala",gu:"Guam",gw:"Guinea-Bissau",gy:"Guyana",
  hk:"Hong Kong",hn:"Honduras",hr:"Croatia",ht:"Haiti",hu:"Hungary",
  id:"Indonesia",ie:"Ireland",il:"Israel",im:"Isle of Man",in:"India",iq:"Iraq",ir:"Iran",is:"Iceland",it:"Italy",
  je:"Jersey",jm:"Jamaica",jo:"Jordan",jp:"Japan",
  ke:"Kenya",kg:"Kyrgyzstan",kh:"Cambodia",km:"Comoros",kn:"St Kitts & Nevis",kr:"South Korea",kw:"Kuwait",ky:"Cayman Islands",kz:"Kazakhstan",
  la:"Laos",lb:"Lebanon",lc:"St Lucia",li:"Liechtenstein",lk:"Sri Lanka",lr:"Liberia",ls:"Lesotho",lt:"Lithuania",lu:"Luxembourg",lv:"Latvia",ly:"Libya",
  ma:"Morocco",mc:"Monaco",md:"Moldova",me:"Montenegro",mg:"Madagascar",mk:"North Macedonia",ml:"Mali",mm:"Myanmar",mn:"Mongolia",mo:"Macao",mq:"Martinique",mr:"Mauritania",ms:"Montserrat",mt:"Malta",mu:"Mauritius",mv:"Maldives",mw:"Malawi",mx:"Mexico",my:"Malaysia",mz:"Mozambique",
  na:"Namibia",nc:"New Caledonia",ne:"Niger",ng:"Nigeria",ni:"Nicaragua",nl:"Netherlands",no:"Norway",np:"Nepal",nz:"New Zealand",
  om:"Oman",pa:"Panama",pe:"Peru",pf:"French Polynesia",pg:"Papua New Guinea",ph:"Philippines",pk:"Pakistan",pl:"Poland",pm:"St Pierre & Miquelon",pr:"Puerto Rico",ps:"Palestine",pt:"Portugal",pw:"Palau",py:"Paraguay",
  qa:"Qatar",re:"Réunion",ro:"Romania",rs:"Serbia",ru:"Russia",rw:"Rwanda",
  sa:"Saudi Arabia",sb:"Solomon Islands",sc:"Seychelles",sd:"Sudan",se:"Sweden",sg:"Singapore",si:"Slovenia",sk:"Slovakia",sl:"Sierra Leone",sm:"San Marino",sn:"Senegal",so:"Somalia",sr:"Suriname",ss:"South Sudan",sv:"El Salvador",sx:"Sint Maarten",sy:"Syria",sz:"Eswatini",
  tc:"Turks & Caicos",td:"Chad",tg:"Togo",th:"Thailand",tj:"Tajikistan",tl:"Timor-Leste",tm:"Turkmenistan",tn:"Tunisia",to:"Tonga",tr:"Türkiye",tt:"Trinidad & Tobago",tw:"Taiwan",tz:"Tanzania",
  ua:"Ukraine",ug:"Uganda",us:"United States",uy:"Uruguay",uz:"Uzbekistan",
  va:"Vatican City",vc:"St Vincent",ve:"Venezuela",vg:"British Virgin Is.",vi:"US Virgin Is.",vn:"Vietnam",vu:"Vanuatu",ws:"Samoa",ye:"Yemen",za:"South Africa",zm:"Zambia",zw:"Zimbabwe",
};

export function countryName(cc?: string): string | undefined {
  // Own properties only: "constructor" is not a country.
  return cc && Object.hasOwn(ISO_NAMES, cc) ? ISO_NAMES[cc] : undefined;
}

/** `Verizon_Charter_LTE_US` -> { cc: "us", display: "Verizon Charter LTE" } */
export function splitName(name: string): { cc?: string; display: string } {
  const m = /^(.*)_([A-Za-z]{2})$/.exec(name);
  if (m && Object.hasOwn(ISO_NAMES, m[2].toLowerCase())) {
    return { cc: m[2].toLowerCase(), display: m[1].replace(/_/g, " ") };
  }
  return { display: name.replace(/_/g, " ") };
}


// The bundle names Apple uses are internal: ATT, TMobile, CMCC, Hutchison.
// What people type into a search box is the brand.
const BRANDS: Record<string, string> = {
  ATT: "AT&T", TMobile: "T-Mobile", CMCC: "China Mobile", Unicom: "China Unicom",
  BhartiAirtel: "Airtel", RelianceJio: "Jio", Idea: "Vi (Idea)", Hutchison: "Three",
  mobilkom: "A1", VimpelCom: "Beeline", Qtel: "Ooredoo", KTF: "KT", LGU: "LG U+", SKT: "SK Telecom",
  KDDI: "KDDI au", Softbank: "SoftBank", Docomo: "NTT Docomo", EPlus: "E-Plus",
  MetroPCS: "Metro by T-Mobile", USCellular: "UScellular", CellularSouth: "C Spire",
  TFW: "Tracfone", aio: "Cricket", Telefonica: "Telefónica Movistar", CW: "Flow (Cable & Wireless)",
  AVEA: "Türk Telekom", Optimus: "NOS", TMN: "MEO",
  CellC: "Cell C", DiGi: "Digi", FarEasTone: "Far EasTone", LuxGSM: "POST Luxembourg",
};

// Radio and SIM flavours: in the bundle name, not in anyone's search.
const TECH = new Set(["LTE", "NR", "only", "ISIM", "CSIM", "USIM", "SIM", "Core"]);

// Split "AlaskaWireless" but not "StarHub" or "SmarTone": only before a generic word.
const GENERIC = /(?<=[a-z])(?=(?:Wireless|Telecom|Telekom|Mobile|Mobility|Network|Cellular|Valley|South|West)(?:[A-Z]|$))/g;

/**
 * How a carrier bundle name reads to a person:
 * ATT_FirstNet_US -> { brand: "AT&T FirstNet", country: "United States" }.
 */
export function carrierName(name: string): { brand: string; country?: string } {
  const { cc, display } = splitName(name);
  // Apple writes UK, which is not an ISO code, so splitName leaves it on.
  const uk = !cc && /_uk$/i.test(name);
  const words = display.split(" ").slice(0, uk ? -1 : undefined).filter((w) => w && !TECH.has(w))
    .map((w) => BRANDS[w] ?? w.replace(GENERIC, " "));
  // TMobile_MetroPCS is "Metro by T-Mobile", not "T-Mobile Metro by T-Mobile".
  const brand = words.filter((w, i) => !words.some((o, j) => j !== i && o.length > w.length && o.includes(w))).join(" ") || display;
  const tail = uk ? "United Kingdom" : countryName(cc);
  // O2_Germany, TIM_Italy: the country is already the last word.
  return { brand, country: tail && !brand.endsWith(tail) ? tail : undefined };
}

/** Country bundle names run the words together: AntiguaAndBarbuda -> Antigua and Barbuda. */
export function countryDisplay(name: string): string {
  return name
    .replace(/(?<=[a-z])(?=[A-Z])/g, " ")
    .replace(/(?<=.) (And|Of|The|Da)\b/g, (_, w: string) => " " + w.toLowerCase());
}
