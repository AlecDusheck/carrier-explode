/** The key of an Apple-issued AEA: HPKE-wrapped in its auth data, beside the URL of the private key that opens it, which Apple serves openly. */

import * as v from "valibot";

import { base64ToBytes, u32le } from "@carrier-explode/binary";
import { hpkeOpen, p256PrivateKey } from "./hpke.ts";

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/** Apple's auth data: u32le length (itself included), then `key NUL value`, repeated. */
export function aeaMetadata(authData: Uint8Array): ReadonlyMap<string, Uint8Array> {
	const metadata = new Map<string, Uint8Array>();
	for (let at = 0; at < authData.length;) {
		const len = u32le(authData, at);
		if (len < 4 || at + len > authData.length)
			throw new Error(`AEA metadata entry at ${at} overruns the auth data`);
		const kv = authData.subarray(at + 4, at + len);
		const nul = kv.indexOf(0);
		if (nul < 0) throw new Error(`AEA metadata entry at ${at} has no key terminator`);
		metadata.set(utf8.decode(kv.subarray(0, nul)), kv.subarray(nul + 1));
		at += len;
	}
	return metadata;
}

const FcsResponse = v.object({ "enc-request": v.string(), "wrapped-key": v.string() });

export async function fcsKey(
	authData: Uint8Array,
	fetchPem: (url: string) => Promise<string>,
): Promise<Uint8Array> {
	const meta = aeaMetadata(authData);
	const response = meta.get("com.apple.wkms.fcs-response");
	const url = meta.get("com.apple.wkms.fcs-key-url");
	if (!response || !url) throw new Error("AEA metadata lacks fcs-response or fcs-key-url");
	const fcs = v.parse(FcsResponse, JSON.parse(utf8.decode(response)));
	const key = await p256PrivateKey(await fetchPem(utf8.decode(url)));
	return hpkeOpen(key, base64ToBytes(fcs["enc-request"]), base64ToBytes(fcs["wrapped-key"]));
}
