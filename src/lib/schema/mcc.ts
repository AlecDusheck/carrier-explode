/**
 * Mobile Country Code -> ISO 3166 alpha-2, from ITU-T E.212. Only a fallback:
 * a source's own name (`_us`, `_gb`) or plist ISO keys win. Where an MCC spans
 * territories (310-316 also serve Guam and the US Virgin Islands by MNC, 340
 * the French Antilles) it maps to the main one; per-MNC detail would need the
 * whole MNC table for a guess that names already settle.
 */

import { countryName, fold } from "#lib/names.ts";

const MCC_ISO = {
  202: "gr", 204: "nl", 206: "be", 208: "fr", 212: "mc", 213: "ad", 214: "es", 216: "hu", 218: "ba", 219: "hr",
  220: "rs", 221: "xk", 222: "it", 225: "va", 226: "ro", 228: "ch", 230: "cz", 231: "sk", 232: "at", 234: "gb",
  235: "gb", 238: "dk", 240: "se", 242: "no", 244: "fi", 246: "lt", 247: "lv", 248: "ee", 250: "ru", 255: "ua",
  257: "by", 259: "md", 260: "pl", 262: "de", 266: "gi", 268: "pt", 270: "lu", 272: "ie", 274: "is", 276: "al",
  278: "mt", 280: "cy", 282: "ge", 283: "am", 284: "bg", 286: "tr", 288: "fo", 290: "gl", 292: "sm", 293: "si",
  294: "mk", 295: "li", 297: "me", 302: "ca", 308: "pm", 310: "us", 311: "us", 312: "us", 313: "us", 314: "us",
  315: "us", 316: "us", 330: "pr", 332: "vi", 334: "mx", 338: "jm", 340: "gp", 342: "bb", 344: "ag", 346: "ky",
  348: "vg", 350: "bm", 352: "gd", 354: "ms", 356: "kn", 358: "lc", 360: "vc", 362: "cw", 363: "aw", 364: "bs",
  365: "ai", 366: "dm", 368: "cu", 370: "do", 372: "ht", 374: "tt", 376: "tc", 400: "az", 401: "kz", 402: "bt",
  404: "in", 405: "in", 406: "in", 410: "pk", 412: "af", 413: "lk", 414: "mm", 415: "lb", 416: "jo", 417: "sy",
  418: "iq", 419: "kw", 420: "sa", 421: "ye", 422: "om", 424: "ae", 425: "il", 426: "bh", 427: "qa", 428: "mn",
  429: "np", 430: "ae", 431: "ae", 432: "ir", 434: "uz", 436: "tj", 437: "kg", 438: "tm", 440: "jp", 441: "jp",
  450: "kr", 452: "vn", 454: "hk", 455: "mo", 456: "kh", 457: "la", 460: "cn", 461: "cn", 466: "tw", 467: "kp",
  470: "bd", 472: "mv", 502: "my", 505: "au", 510: "id", 514: "tl", 515: "ph", 520: "th", 525: "sg", 528: "bn",
  530: "nz", 536: "nr", 537: "pg", 539: "to", 540: "sb", 541: "vu", 542: "fj", 543: "wf", 544: "as", 545: "ki",
  546: "nc", 547: "pf", 548: "ck", 549: "ws", 550: "fm", 551: "mh", 552: "pw", 553: "tv", 555: "nu", 602: "eg",
  603: "dz", 604: "ma", 605: "tn", 606: "ly", 607: "gm", 608: "sn", 609: "mr", 610: "ml", 611: "gn", 612: "ci",
  613: "bf", 614: "ne", 615: "tg", 616: "bj", 617: "mu", 618: "lr", 619: "sl", 620: "gh", 621: "ng", 622: "td",
  623: "cf", 624: "cm", 625: "cv", 626: "st", 627: "gq", 628: "ga", 629: "cg", 630: "cd", 631: "ao", 632: "gw",
  633: "sc", 634: "sd", 635: "rw", 636: "et", 637: "so", 638: "dj", 639: "ke", 640: "tz", 641: "ug", 642: "bi",
  643: "mz", 645: "zm", 646: "mg", 647: "re", 648: "zw", 649: "na", 650: "mw", 651: "ls", 652: "bw", 653: "sz",
  654: "km", 655: "za", 657: "er", 658: "sh", 659: "ss", 702: "bz", 704: "gt", 706: "sv", 708: "hn", 710: "ni",
  712: "cr", 714: "pa", 716: "pe", 722: "ar", 724: "br", 730: "cl", 732: "co", 734: "ve", 736: "bo", 738: "gy",
  740: "ec", 742: "gf", 744: "py", 746: "sr", 748: "uy", 750: "fk",
} as const satisfies Readonly<Record<number, string>>;

const BY_MCC: ReadonlyMap<string, string> = new Map(Object.entries(MCC_ISO));

/** ISO code for the MCC that starts `mccOrPlmn` (`310`, `310260`), if E.212 assigns it to one country. */
export const isoForMcc = (mccOrPlmn: string): string | undefined => BY_MCC.get(mccOrPlmn.slice(0, 3));

/** "unitedstates" -> "us": names.ts country names, folded, for bundle names like `UnitedStates`. */
const BY_NAME: ReadonlyMap<string, string> = new Map(
  [...new Set(BY_MCC.values())].flatMap((iso) => {
    const name = countryName(iso);
    return name === undefined ? [] : [[fold(name), iso] as const];
  }),
);

/** ISO code for a country written as Apple writes it in bundle names and ids: `UnitedStates`, `com.apple.UnitedStates`. */
export function isoForCountryName(name: string): string | undefined {
  return BY_NAME.get(fold(name.replace(/^com\.apple\./, "")));
}
