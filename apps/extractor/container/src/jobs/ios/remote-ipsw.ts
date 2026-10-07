/** An IPSW read in place: its central directory and BuildManifest, over Range requests. */

import { openRemoteZip, type RemoteZip } from "@carrier-explode/firmware";
import { parseBuildManifest, type BuildManifest } from "@carrier-explode/decode-ios";
import { DataError } from "../../../../src/errors.ts";

export interface RemoteIpsw {
	readonly url: string;
	readonly zip: RemoteZip;
	readonly manifest: BuildManifest;
}

export async function openIpsw(url: string): Promise<RemoteIpsw> {
	const zip = await openRemoteZip(url);
	const entry = zip.entry("BuildManifest.plist");
	if (!entry) throw new DataError(`${url} has no BuildManifest.plist`);
	return { url, zip, manifest: parseBuildManifest(await zip.read(entry)) };
}
