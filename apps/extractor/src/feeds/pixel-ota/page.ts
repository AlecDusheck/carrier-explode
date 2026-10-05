/** Google's Pixel OTA page: devices and their full OTA builds. The cookie acknowledges its terms wall. */

import { fetchWithRetry } from "@carrier-explode/http";

export const OTA_PAGE = "https://developers.google.com/android/ota";
const ACK_COOKIE = "devsite_wall_acks=nexus-ota-tos";

export class OtaPageError extends Error {
  override name = "OtaPageError";
}

export interface OtaBuild {
  readonly device: string;
  /** Upper case, as Google prints it: `CP3A.260905.009`. */
  readonly build: string;
  /** `17.0.0` */
  readonly android: string;
  /** YYYY-MM, from the row's month. */
  readonly patch: string;
  /** Carrier or region a variant build is for (`Verizon`, `EMEA`); absent for the general build. */
  readonly variant?: string;
  readonly url: string;
}

export interface OtaDevice {
  readonly device: string;
  /** `Pixel 9` */
  readonly name: string;
  /** Oldest first, as the page lists them. */
  readonly builds: readonly OtaBuild[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const ENTITIES = new Map([["&amp;", "&"], ["&quot;", '"'], ["&#39;", "'"], ["&lt;", "<"], ["&gt;", ">"]]);
const text = (s: string): string => s.replace(/&[#\w]+;/g, (e) => ENTITIES.get(e) ?? e).trim();

/** `Sep 2026` -> `2026-09`. */
function month(label: string): string | undefined {
  const [, name, year] = /^([A-Z][a-z]{2}) (\d{4})$/.exec(label) ?? [];
  const index = MONTHS.findIndex((m) => m === name);
  return index < 0 || year === undefined ? undefined : `${year}-${String(index + 1).padStart(2, "0")}`;
}

/** One `<tr>`: the version cell and the zip link. Rows that are not full OTAs (factory images, notes) give undefined. */
function row(device: string, html: string): OtaBuild | undefined {
  const cell = html.match(/<td>\s*([\d.]+) \(([^)]*)\)\s*<\/td>/);
  const url = html.match(/href="(https:\/\/dl\.google\.com\/[^"]+-ota-[^"]+\.zip)"/)?.[1];
  if (!cell?.[1] || cell[2] === undefined || !url) return undefined;
  const [build, when, ...rest] = cell[2].split(",").map(text);
  const patch = when === undefined ? undefined : month(when);
  if (!build || !patch) return undefined;
  const variant = rest.join(", ");
  return { device, build, android: cell[1], patch, url, ...(variant ? { variant } : {}) };
}

export function parseOtaPage(html: string): OtaDevice[] {
  const devices: OtaDevice[] = [];
  const heads = [...html.matchAll(/<h2 id="[\w-]+" data-text='"([\w-]+)" for ([^']+)'/g)];
  heads.forEach((h, i) => {
    const [, codename, name] = h;
    if (codename === undefined || name === undefined) return;
    const section = html.slice(h.index, heads[i + 1]?.index ?? html.length);
    const builds = [...section.matchAll(/<tr[\s\S]*?<\/tr>/g)].flatMap((m) => row(codename, m[0]) ?? []);
    if (builds.length) devices.push({ device: codename, name: text(name), builds });
  });
  if (!devices.length) throw new OtaPageError("no devices found on the OTA page: its layout changed, or the terms wall was served");
  return devices;
}

/** Google serves its terms wall to about a third of requests despite the cookie; a fresh request usually passes. */
const WALL_TRIES = 6;

export async function fetchOtaPage(): Promise<OtaDevice[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchWithRetry(OTA_PAGE, { headers: { cookie: ACK_COOKIE } });
    try {
      return parseOtaPage(await res.text());
    } catch (e) {
      if (!(e instanceof OtaPageError) || attempt === WALL_TRIES) throw e;
    }
  }
}
