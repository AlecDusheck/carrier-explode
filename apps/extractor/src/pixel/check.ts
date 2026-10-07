/**
 * The Pixel OTA feed: Google's Pixel OTA page (a cookie acknowledges its terms wall), and source.android.com's build
 * numbers, which keep the builds the OTA page drops and so date a Pixel's first build.
 */

import { indexDb, syncDevices, syncLabels, type ListedDevice } from "@carrier-explode/db";
import { fetchWithRetry } from "@carrier-explode/http";
import type { Env } from "../env.ts";
import { devicesSynced } from "../queues.ts";
import { heldReleases } from "../store.ts";
import { planPixel, type PixelDevice } from "./plan.ts";

const ENTITIES = new Map([
	["&amp;", "&"],
	["&quot;", '"'],
	["&#39;", "'"],
	["&lt;", "<"],
	["&gt;", ">"],
]);
const text = (s: string): string => s.replace(/&[#\w]+;/g, (e) => ENTITIES.get(e) ?? e).trim();

const OTA_PAGE = "https://developers.google.com/android/ota";
const ACK_COOKIE = "devsite_wall_acks=nexus-ota-tos";

class OtaPageError extends Error {
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
	if (!devices.length)
		throw new OtaPageError(
			"no devices found on the OTA page: its layout changed, or the terms wall was served",
		);
	return devices;
}

/** Google serves its terms wall to some requests despite the cookie; a fresh request usually passes. */
const WALL_TRIES = 6;

async function fetchOtaPage(): Promise<OtaDevice[]> {
	for (let attempt = 1; ; attempt++) {
		const res = await fetchWithRetry(OTA_PAGE, { headers: { cookie: ACK_COOKIE } });
		try {
			return parseOtaPage(await res.text());
		} catch (e) {
			if (!(e instanceof OtaPageError) || attempt === WALL_TRIES) throw e;
		}
	}
}

const BUILD_NUMBERS = "https://source.android.com/docs/setup/reference/build-numbers";

const cellText = (html: string): string => text(html.replace(/<[^>]+>/g, ""));

/** A device name reduced for matching: the pages write `Pixel 8 Pro` and `Pixel 8 pro`, `Pixel 4a (5G)` and `Pixel 4a 5G`. */
const foldName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Folded device name -> YYYY-MM of the earliest security patch level of a build that supports it. */
export function firstPatches(html: string): ReadonlyMap<string, string> {
	const start = html.indexOf('id="source-code-tags-and-builds"');
	const end = html.indexOf("</table>", start);
	if (start < 0 || end < 0) throw new Error(`${BUILD_NUMBERS}: no table of builds; its layout changed`);
	const first = new Map<string, string>();
	for (const [tr] of html.slice(start, end).matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
		const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1] ?? ""));
		const [, , , supported, patch] = cells;
		const patchMonth = /^(\d{4}-\d{2})-\d{2}$/.exec(patch ?? "")?.[1];
		if (cells.length !== 5 || supported === undefined || patchMonth === undefined) continue;
		// One row separates its devices with a full-width comma.
		for (const name of supported
			.split(/[,，]/)
			.map(foldName)
			.filter(Boolean)) {
			const held = first.get(name);
			if (held === undefined || patchMonth < held) first.set(name, patchMonth);
		}
	}
	if (first.size === 0)
		throw new Error(`${BUILD_NUMBERS}: no build names a device with a patch level; its layout changed`);
	return first;
}

const fetchFirstPatches = async (): Promise<ReadonlyMap<string, string>> =>
	firstPatches(await (await fetchWithRetry(BUILD_NUMBERS)).text());

/** The earlier of the OTA page's first build and the build numbers' first patch for the phone of that name. */
export const pixelDevices = (
	page: readonly OtaDevice[],
	patches: ReadonlyMap<string, string>,
): ListedDevice[] =>
	page.flatMap((d) => {
		const [ota] = d.builds.map((b) => b.patch).toSorted();
		if (ota === undefined) return [];
		const listed = patches.get(foldName(d.name));
		return [
			{
				code: d.device,
				platform: "android",
				released: listed !== undefined && listed < ota ? listed : ota,
				boards: [],
			},
		];
	});

export async function checkPixel(env: Env): Promise<PixelDevice[]> {
	const [page, patches] = await Promise.all([fetchOtaPage(), fetchFirstPatches()]);
	// Google heads each phone's section with its name, and its builds date it: pages name and order Pixels from the feed.
	const records = pixelDevices(page, patches);
	const db = indexDb(env.DB);
	const names = await syncLabels(
		db,
		"device",
		"name",
		page.map((d) => ({ code: d.device, value: d.name })),
		OTA_PAGE,
	);
	await devicesSynced(env, "android", { devices: await syncDevices(db, records), names });
	const held = new Set((await heldReleases(env.BUCKET, "android")).map((k) => k.id.join("/")));
	return planPixel(env.SCOPE, page, records, held);
}
