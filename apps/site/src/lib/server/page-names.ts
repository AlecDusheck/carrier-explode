/** What a page's head calls the carrier, build and modem its route names: the index's names, not the codes in the URL. */

import { countryName, isPlatform, isReleasePlatform, type ReleasePlatform } from "@carrier-explode/schema";
import { sourceKey, type KindSegment } from "@carrier-explode/schema/types";
import { phoneList } from "#lib/apple/phones.ts";
import { refOf } from "#lib/at.ts";
import { releaseLabel } from "#lib/naming.ts";
import type { PageNames } from "#lib/types.ts";
import { getBuildModems } from "./builds";
import { listEntries } from "./lists";
import { hasPrevious, releaseNamed } from "./releases";

interface NamedParams {
	readonly kind?: KindSegment | undefined;
	readonly platform?: string | undefined;
	readonly name?: string | undefined;
	readonly build?: string | undefined;
	readonly modem?: string | undefined;
}

async function sourceNames(p: NamedParams): Promise<PageNames["source"]> {
	if (p.kind === undefined || p.platform === undefined || !isPlatform(p.platform) || p.name === undefined)
		return null;
	const key = sourceKey(refOf({ kind: p.kind, platform: p.platform, name: p.name }));
	const entry = (await listEntries([key])).get(key);
	return entry === undefined
		? null
		: { brand: entry.brand, country: entry.cc === undefined ? null : (countryName(entry.cc) ?? null) };
}

async function modemNames(
	platform: ReleasePlatform,
	build: string,
	modem: string,
): Promise<PageNames["modem"]> {
	const m = (await getBuildModems(platform, build)).find((x) => x.id === modem);
	return m === undefined ? null : { label: m.label, phones: phoneList(m.devices) };
}

/** The build and its modem, read only once the index has the build: a missing one is its page's 404, not the head's. */
async function buildNames(p: NamedParams): Promise<Pick<PageNames, "release" | "modem">> {
	if (p.platform === undefined || !isReleasePlatform(p.platform) || p.build === undefined)
		return { release: null, modem: null };
	const [r, compared] = await Promise.all([
		releaseNamed(p.platform, p.build),
		hasPrevious(p.platform, p.build),
	]);
	return {
		release: r === null ? null : { label: releaseLabel(r), compared },
		modem: r === null || p.modem === undefined ? null : await modemNames(p.platform, p.build, p.modem),
	};
}

export async function pageNames(p: NamedParams): Promise<PageNames> {
	const [source, build] = await Promise.all([sourceNames(p), buildNames(p)]);
	return { source, ...build };
}
