/**
 * Google's Pixel carrier settings update service: com.google.android.carrier's Phenotype flags, naming each carrier file
 * newer than a build's image. Request and flag layout from GrapheneOS adevtool (src/blobs/carrier.ts).
 */

import * as v from "valibot";

import { concatBytes, wireFields } from "@carrier-explode/binary";
import { fetchWithRetry } from "@carrier-explode/http";

const UPDATE_SERVICE = "https://www.googleapis.com/experimentsandconfigs/v1/getExperimentsAndConfigs?r=6&c=1";
const PACKAGE = "com.google.android.carrier";
const UPDATE_CONFIG = "CarrierSettings__update_config";
/** Every file's URL also serves its sha256, in hex, at this suffix (the CarrierSettings__checksum_suffix flag). */
export const CHECKSUM_SUFFIX = ".sha256";
/** Files are served only from here; anything else in an answer is refused. */
const ORIGIN = "https://ssl.gstatic.com";

const str = v.pipe(v.string(), v.minLength(1));

/** What a check asked the service, and its answers: the check writes it, the Pixel OTA unit reads it. */
export const pixelOtaSnapshotSchema = v.object({
	answers: v.array(
		v.object({
			device: str,
			train: str,
			files: v.array(
				v.object({
					name: str,
					version: v.pipe(v.string(), v.regex(/^\d+$/)),
					url: v.pipe(v.string(), v.url()),
				}),
			),
		}),
	),
});

export type PixelOtaSnapshot = v.InferOutput<typeof pixelOtaSnapshotSchema>;

class UpdateServiceError extends Error {
	override name = "UpdateServiceError";
}

/** What the service says for one Pixel on one train; `files` is empty when it has nothing newer than the image. */
export type UpdateAnswer = PixelOtaSnapshot["answers"][number];
/** One file an answer lists: `carrier_list`, or a carrier's CarrierSettings. */
export type UpdateFile = UpdateAnswer["files"][number];

const enc = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

function varint(n: number): Uint8Array {
	const out: number[] = [];
	for (let rest = n; ; rest = Math.floor(rest / 128)) {
		if (rest < 128) return new Uint8Array([...out, rest]);
		out.push((rest % 128) | 128);
	}
}

const tagged = (field: number, wire: 0 | 2, body: Uint8Array): Uint8Array =>
	concatBytes([varint((field << 3) | wire), ...(wire === 2 ? [varint(body.length)] : []), body]);
const message = (field: number, ...parts: Uint8Array[]): Uint8Array => tagged(field, 2, concatBytes(parts));
const text = (field: number, s: string): Uint8Array => tagged(field, 2, enc.encode(s));
const int = (field: number, n: number): Uint8Array => tagged(field, 0, varint(n));

/** The train is all the service reads of a build id, so the request carries only it. */
export function updateRequest(device: string, train: string): Uint8Array {
	const info = concatBytes([
		int(3, 36),
		text(5, device),
		text(6, train),
		text(8, device),
		text(9, device),
		text(11, "en"),
		text(12, "US"),
		text(13, "Google"),
		text(14, "google"),
		text(15, device),
	]);
	return concatBytes([
		message(1, message(4, int(1, 4), message(2, info))),
		message(2, message(1, text(1, PACKAGE))),
	]);
}

/** The bytes field `n` of `bytes`, which must occur once. */
function only(bytes: Uint8Array, n: number, what: string): Uint8Array {
	const found = [...wireFields(bytes)].flatMap((f) => (f.field === n && f.wire === "bytes" ? [f.value] : []));
	const [one, ...rest] = found;
	if (one === undefined || rest.length)
		throw new UpdateServiceError(`the answer has ${found.length} ${what}`);
	return one;
}

/** The update_config map, or an empty one when the answer has no such flag (`is_pixel: prod`, nothing to update). */
export function updateConfig(response: Uint8Array): ReadonlyMap<string, string> {
	const flags = only(only(response, 1, "results"), 2, "flag lists");
	for (const f of wireFields(flags)) {
		if (f.field !== 2 || f.wire !== "bytes") continue;
		const flag = [...wireFields(f.value)];
		const name = flag.find((x) => x.field === 1 && x.wire === "bytes");
		const value = flag.find((x) => x.field === 6 && x.wire === "bytes");
		if (name?.wire !== "bytes" || utf8.decode(name.value) !== UPDATE_CONFIG || value?.wire !== "bytes")
			continue;
		const entries = new Map<string, string>();
		for (const e of wireFields(only(value.value, 1, "maps"))) {
			if (e.field !== 1 || e.wire !== "bytes") continue;
			const kv = [...wireFields(e.value)];
			const k = kv.find((x) => x.field === 1 && x.wire === "bytes");
			const entryValue = kv.find((x) => x.field === 2 && x.wire === "bytes");
			if (k?.wire === "bytes")
				entries.set(utf8.decode(k.value), entryValue?.wire === "bytes" ? utf8.decode(entryValue.value) : "");
		}
		return entries;
	}
	return new Map();
}

/** Java's String.format for the conversions the templates use: %s and %d, in turn or by index (`%2$s`), and %%. */
function javaFormat(template: string, args: readonly string[]): string {
	let next = 0;
	return template.replace(/%(?:(\d+)\$)?([sd%])/g, (whole, index: string | undefined, conversion: string) => {
		if (conversion === "%") return "%";
		const arg = args[index === undefined ? next++ : Number(index) - 1];
		if (arg === undefined) throw new UpdateServiceError(`${template}: ${whole} has no argument`);
		return arg;
	});
}

/**
 * The app formats the list's template with its version, and the settings template with the product (Build.PRODUCT,
 * a Pixel's codename, when the product_alias flag is empty, as it always is), the carrier and the version.
 */
function urlOf(template: string | undefined, device: string, name: string, version: string): string {
	if (template === undefined) throw new UpdateServiceError(`the answer lists ${name} without a URL template`);
	const url =
		name === "carrier_list" ? javaFormat(template, [version]) : javaFormat(template, [device, name, version]);
	if (new URL(url).origin !== ORIGIN) throw new UpdateServiceError(`${url} is not on ${ORIGIN}`);
	return url;
}

/** The files an update_config map lists for `device`, each with its URL. */
export function updateFiles(config: ReadonlyMap<string, string>, device: string): UpdateFile[] {
	return [...config]
		.flatMap(([name, version]): UpdateFile[] => {
			if (name === "carrier_list_url" || name === "carrier_settings_url" || name === "is_pixel") return [];
			if (!/^\d+$/.test(version))
				throw new UpdateServiceError(`${name}'s version ${version} is not a number`);
			const template = config.get(name === "carrier_list" ? "carrier_list_url" : "carrier_settings_url");
			return [{ name, version, url: urlOf(template, device, name, version) }];
		})
		.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function askUpdates(device: string, train: string): Promise<UpdateAnswer> {
	const res = await fetchWithRetry(UPDATE_SERVICE, {
		method: "POST",
		headers: { "content-type": "application/x-protobuf" },
		body: updateRequest(device, train),
	});
	return { device, train, files: updateFiles(updateConfig(new Uint8Array(await res.arrayBuffer())), device) };
}
