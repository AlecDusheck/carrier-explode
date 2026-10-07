/** An IPSW's modem packages: each read by Range to disk, stored, and summarized in the same pass. */

import { readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { crc32, inflateRaw } from "node:zlib";

import { latin1, u32Hex } from "@carrier-explode/binary";
import {
	basebandSummary,
	ftabSummary,
	MODEM_SUMMARY_SCHEMA,
	modemDevices,
	type BuildManifest,
	type ModemSummary,
} from "@carrier-explode/decode-ios";
import { bytesSource, openZip } from "@carrier-explode/firmware";
import type { ModemPackage } from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import type { IpswOutput } from "../../../../../src/apple/ipsw.ts";
import { DataError } from "../../../../../src/errors.ts";
import type { JobContext } from "../../../job.ts";
import { fetchMember } from "../fetch-member.ts";
import type { RemoteIpsw } from "../remote-ipsw.ts";

/** What a modem package needs of a zip entry (firmware's ZipEntry has it). */
export interface MemberInfo {
	readonly name: string;
	readonly size: number;
	readonly crc32: number;
}

/** A modem package in an IPSW. `name` is its path under Firmware/, which the decoder reads the family off. */
export interface ModemMember extends Pick<ModemPackage, "name" | "size" | "crc32" | "kind"> {
	/** Path inside the IPSW. */
	readonly member: string;
	/** The phones it is the modem of. */
	readonly devices: readonly string[];
}

/** Modem packages among an IPSW's entries: only what its manifest names as a modem. */
export function modemMembers(entries: readonly MemberInfo[], manifest: BuildManifest): ModemMember[] {
	const devices = modemDevices(manifest);
	return entries.flatMap((e) => {
		const d = devices.get(e.name);
		return d === undefined
			? []
			: [
					{
						member: e.name,
						name: e.name.replace(/^Firmware\//, ""),
						size: e.size,
						crc32: u32Hex(e.crc32),
						kind: e.name.endsWith(".bbfw") ? "bbfw" : "ftab",
						devices: d,
					},
				];
	});
}

/** The only bbfw members the summary reads; the rest (hundreds of MB) stay compressed. */
const BBFW_MEMBERS = new Set(["bbcfg.mbn", "pt.mbn", "Info.plist", "qdsp6sw.mbn"]);

const isFtab = (b: Uint8Array): boolean => latin1(b.subarray(0x20, 0x28)) === "rkosftab";

const inflated = promisify(inflateRaw);

const view = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.length);

/** A bbfw's file listing and the members the summary reads, inflated on libuv's pool so bucket requests keep being served. */
async function bbfwMembers(
	bytes: Uint8Array,
	name: string,
): Promise<{ listing: Array<{ name: string; size: number }>; members: Record<string, Uint8Array> }> {
	const zip = await openZip(bytesSource(bytes, name));
	const files = zip.entries.filter((e) => !e.name.endsWith("/"));
	const members: Record<string, Uint8Array> = {};
	for (const e of files.filter((f) => BBFW_MEMBERS.has(basename(f.name)))) {
		if (e.method !== 0 && e.method !== 8)
			throw new DataError(`${name}: ${e.name} has zip method ${e.method}, not stored or deflate`);
		const at = await zip.dataOffset(e);
		const raw = bytes.subarray(at, at + e.compressedSize);
		const data = e.method === 8 ? view(await inflated(raw)) : raw;
		if (data.length !== e.size || crc32(data) !== e.crc32)
			throw new DataError(
				`${name}: ${e.name} inflates to ${data.length} bytes with CRC-32 ${crc32(data).toString(16)}, not ${e.size} and ${e.crc32.toString(16)}`,
			);
		members[basename(e.name)] = data;
	}
	return { listing: files.map((f) => ({ name: f.name, size: f.size })), members };
}

async function modemSummary(file: string, name: string): Promise<ModemSummary> {
	const bytes = view(await readFile(file));
	if (isFtab(bytes)) return ftabSummary(bytes, { name });
	const { listing, members } = await bbfwMembers(bytes, name);
	return basebandSummary(members, { name, listing });
}

/** Each package stored as obj/<sha256>, its summary at decoded/baseband/. */
export async function storeModems(ipsw: RemoteIpsw, ctx: JobContext): Promise<IpswOutput["modems"]> {
	const out: IpswOutput["modems"] = [];
	for (const m of modemMembers(ipsw.zip.entries, ipsw.manifest)) {
		const entry = ipsw.zip.entry(m.member);
		if (entry === undefined) throw new DataError(`${ipsw.url} lost ${m.member}`);
		const file = join(ctx.tmp, `package.${m.kind}`);
		try {
			const sha = await fetchMember(ipsw.zip, ipsw.url, entry, file);
			await ctx.bucket.putObj(sha, { file }, m.kind === "bbfw" ? "apple.bbfw" : "apple.ftab");
			const summary = await modemSummary(file, m.name);
			const family = summary.package.family;
			if (!family) throw new DataError(`${m.name}: no modem family in the name`);
			await ctx.bucket.putOnce(
				keys.basebandSummary(MODEM_SUMMARY_SCHEMA, sha),
				JSON.stringify(summary),
				"application/json",
			);
			ctx.log(`${m.name}: ${sha}`);
			out.push({
				family,
				devices: [...m.devices],
				package: { kind: m.kind, name: m.name, sha, size: m.size, crc32: m.crc32 },
			});
		} finally {
			await rm(file, { force: true });
		}
	}
	return out;
}
