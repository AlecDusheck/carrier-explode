/** payload.bin (update_engine's update_metadata.proto). In a full OTA every operation writes whole blocks from its own blob. */

import { asciiAt, safeU64be, toSafe, u32be, wireFields, type WireField } from "@carrier-explode/binary";
import type { Decompressors } from "./codecs.ts";
import type { RangeSource } from "./source.ts";
import type { RemoteZip } from "./zip.ts";

export class PayloadFormatError extends Error {
	override name = "PayloadFormatError";
}

/** InstallOperation.Type by number. The ones after DISCARD that are not REPLACE_* read a source image: incremental OTAs. */
const OP_TYPES = [
	"REPLACE",
	"REPLACE_BZ",
	"MOVE",
	"BSDIFF",
	"SOURCE_COPY",
	"SOURCE_BSDIFF",
	"ZERO",
	"DISCARD",
	"REPLACE_XZ",
	"PUFFDIFF",
	"BROTLI_BSDIFF",
	"ZUCCHINI",
	"LZ4DIFF_BSDIFF",
	"LZ4DIFF_PUFFDIFF",
	"REPLACE_ZSTD",
] as const;
type OpType = (typeof OP_TYPES)[number] | `UNKNOWN_${number}`;

interface Extent {
	readonly startBlock: number;
	readonly numBlocks: number;
}

export interface InstallOp {
	readonly type: OpType;
	/** Blob offset, relative to Payload.dataOffset. */
	readonly dataOffset: number;
	readonly dataLength: number;
	readonly dstExtents: readonly Extent[];
	readonly dataSha256?: Uint8Array;
}

interface PartitionUpdate {
	readonly name: string;
	/** new_partition_info.size. */
	readonly size: number;
	readonly operations: readonly InstallOp[];
}

export interface Payload {
	readonly source: RangeSource;
	readonly blockSize: number;
	/** Absolute offset of the blob area in `source`. */
	readonly dataOffset: number;
	readonly partitions: readonly PartitionUpdate[];
	/** The manifest has dynamic_partition_metadata: its partitions are logical images, not a retrofit super's block devices. */
	readonly dynamicPartitions: boolean;
	readonly decompressors: Decompressors;
	partition(name: string): PartitionUpdate | undefined;
}

export interface PayloadOptions {
	readonly decompressors: Decompressors;
}

const MAGIC = "CrAU";
/** Magic, u64 version, u64 manifest size, u32 metadata signature size. */
const HEADER_SIZE = 24;
/** The only version A/B devices have shipped since Android 8. */
const VERSION = 2;
/** block_size's declared proto default. */
const DEFAULT_BLOCK_SIZE = 4096;
const BLOCK_SIZES = new Set([512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]);

type Message = readonly WireField[];

const message = (b: Uint8Array): Message => [...wireFields(b)];

/** The last occurrence wins, as proto2 reads a scalar seen twice. */
function uint(m: Message, field: number): number | undefined {
	const f = m.findLast((x) => x.field === field && x.wire === "varint");
	return f?.wire === "varint" ? toSafe(f.value, `field ${field}`) : undefined;
}

function bytes(m: Message, field: number): Uint8Array | undefined {
	const f = m.findLast((x) => x.field === field && x.wire === "bytes");
	return f?.wire === "bytes" ? f.value : undefined;
}

function messages(m: Message, field: number): Message[] {
	return m.flatMap((x) => (x.field === field && x.wire === "bytes" ? [message(x.value)] : []));
}

function extent(m: Message): Extent {
	return { startBlock: uint(m, 1) ?? 0, numBlocks: uint(m, 2) ?? 0 };
}

function operation(m: Message): InstallOp {
	const type = uint(m, 1);
	if (type === undefined) throw new PayloadFormatError("operation without a type");
	const hash = bytes(m, 8);
	return {
		type: OP_TYPES[type] ?? `UNKNOWN_${type}`,
		dataOffset: uint(m, 2) ?? 0,
		dataLength: uint(m, 3) ?? 0,
		dstExtents: messages(m, 6).map(extent),
		...(hash === undefined ? {} : { dataSha256: hash }),
	};
}

function partitionUpdate(m: Message): PartitionUpdate {
	const raw = bytes(m, 1);
	if (raw === undefined) throw new PayloadFormatError("partition without a name");
	const name = new TextDecoder().decode(raw);
	const [info] = messages(m, 7);
	const size = info && uint(info, 1);
	if (size === undefined) throw new PayloadFormatError(`partition ${name} has no new_partition_info.size`);
	return { name, size, operations: messages(m, 8).map(operation) };
}

/** Header and manifest of a payload.bin held in `src`. */
export async function openPayloadSource(src: RangeSource, opts: PayloadOptions): Promise<Payload> {
	const head = await src.read(0, HEADER_SIZE);
	if (!asciiAt(head, 0, MAGIC))
		throw new PayloadFormatError(`${src.label}: not a payload (no ${MAGIC} magic)`);
	const version = safeU64be(head, 4);
	if (version !== VERSION)
		throw new PayloadFormatError(`${src.label}: payload version ${version} is not supported`);
	const manifestSize = safeU64be(head, 12);
	const signatureSize = u32be(head, 20);
	const manifest = message(await src.read(HEADER_SIZE, manifestSize));
	const blockSize = uint(manifest, 3) ?? DEFAULT_BLOCK_SIZE;
	if (!BLOCK_SIZES.has(blockSize)) throw new PayloadFormatError(`${src.label}: block size ${blockSize}`);
	const partitions = messages(manifest, 13).map(partitionUpdate);
	const byName = new Map(partitions.map((p) => [p.name, p]));
	return {
		source: src,
		blockSize,
		dataOffset: HEADER_SIZE + manifestSize + signatureSize,
		partitions,
		dynamicPartitions: manifest.some((f) => f.field === 15),
		decompressors: opts.decompressors,
		partition: (name) => byName.get(name),
	};
}

/** payload.bin inside an OTA zip, where it is stored uncompressed and read in place. */
export async function openPayload(zip: RemoteZip, opts: PayloadOptions): Promise<Payload> {
	const entry = zip.entry("payload.bin");
	if (!entry) throw new PayloadFormatError(`${zip.source.label}: no payload.bin (not an A/B OTA)`);
	return openPayloadSource(await zip.storedSource(entry), opts);
}
