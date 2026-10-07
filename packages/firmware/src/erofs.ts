/**
 * Read-only EROFS (linux fs/erofs/erofs_fs.h): every layout, LZ4-compressed files too (./erofs-z.ts). A compression
 * this reader lacks throws ErofsCompressedError, so callers can tell that from corruption.
 */

import { safeU64le, u16le, u32le, u8 } from "@carrier-explode/binary";
import { streamCompressed } from "./erofs-z.ts";
import {
	collect,
	FsError,
	kindOfDirent,
	pathFilesystem,
	STREAM_PIECE,
	zeros,
	type DirEntry,
	type Filesystem,
	type InodeStore,
} from "./fs.ts";
import { readPieces, type RangeSource } from "./source.ts";

const SUPERBLOCK_AT = 1024;
const SUPERBLOCK_SIZE = 128;
const EROFS_MAGIC = 0xe0f5e1e2;
const MIN_BLOCK_BITS = 9;
const MAX_BLOCK_BITS = 16;
/** Compact inodes are 32 bytes and nids count in them; extended ones are 64. */
const NID_UNIT = 32;
const EXTENDED_INODE = 64;
const XATTR_HEADER = 12;
const XATTR_ENTRY_UNIT = 4;
const DIRENT = 12;

const LAYOUTS = [
	"FLAT_PLAIN",
	"COMPRESSED_FULL",
	"FLAT_INLINE",
	"COMPRESSED_COMPACT",
	"CHUNK_BASED",
] as const;
type Layout = (typeof LAYOUTS)[number];

const CHUNK_BLKBITS_MASK = 0x1f;
const CHUNK_INDEXES = 0x20;
const NULL_ADDR = 0xffffffff;

/** feature_incompat: LZ4 clusters are stored right-aligned after zeros. */
const LZ4_0PADDING = 0x1;

interface Superblock {
	readonly blockSize: number;
	readonly rootNid: number;
	readonly metaBlock: number;
	readonly dirBlockSize: number;
	readonly zeroPadding: boolean;
}

interface Inode {
	readonly nid: number;
	readonly mode: number;
	readonly size: number;
	readonly layout: Layout;
	/** i_u: the raw block address, or the chunk format. */
	readonly union: number;
	/** End of the inode and its inline xattrs, where an inline tail or chunk table starts. */
	readonly bodyEnd: number;
}

export function isErofs(superblock: Uint8Array): boolean {
	return superblock.length >= 4 && u32le(superblock, 0) === EROFS_MAGIC;
}

class ErofsStore implements InodeStore<Inode> {
	private readonly r: RangeSource;
	private readonly sb: Superblock;

	constructor(r: RangeSource, sb: Superblock) {
		this.r = r;
		this.sb = sb;
	}

	root(): Promise<Inode> {
		return this.node(this.sb.rootNid);
	}

	mode(ino: Inode): number {
		return ino.mode;
	}

	private bad(nid: number, why: string): FsError {
		return new FsError(`${this.r.label}: nid ${nid}: ${why}`);
	}

	async node(nid: number): Promise<Inode> {
		const pos = this.sb.metaBlock * this.sb.blockSize + nid * NID_UNIT;
		const head = await this.r.read(pos, Math.min(EXTENDED_INODE, this.r.size - pos));
		const format = u16le(head, 0);
		const extended = (format & 1) === 1;
		const layout = LAYOUTS[(format >> 1) & 7];
		if (layout === undefined) throw this.bad(nid, `unknown data layout ${(format >> 1) & 7}`);
		const xattrCount = u16le(head, 2);
		const xattrSize = xattrCount === 0 ? 0 : XATTR_HEADER + (xattrCount - 1) * XATTR_ENTRY_UNIT;
		const size = extended ? safeU64le(head, 8) : u32le(head, 8);
		// Android images are never sparse past their own size, and LZ4 expands at most 255-fold: a larger file is
		// corrupt, not one to allocate.
		const compressed = layout === "COMPRESSED_FULL" || layout === "COMPRESSED_COMPACT";
		if (size > this.r.size * (compressed ? 255 : 1)) throw this.bad(nid, `claims ${size} bytes`);
		return {
			nid,
			mode: u16le(head, 4),
			size,
			layout,
			union: u32le(head, 16),
			bodyEnd: pos + (extended ? EXTENDED_INODE : NID_UNIT) + xattrSize,
		};
	}

	/** A chunk table follows the inode, aligned to its entry size: u32 block addresses, or 8-byte indexes. */
	private async *chunked(ino: Inode): AsyncGenerator<Uint8Array> {
		const bs = this.sb.blockSize;
		const chunkSize = bs * 2 ** (ino.union & CHUNK_BLKBITS_MASK);
		const indexed = (ino.union & CHUNK_INDEXES) !== 0;
		const unit = indexed ? 8 : 4;
		const count = Math.ceil(ino.size / chunkSize);
		const table = await this.r.read(Math.ceil(ino.bodyEnd / unit) * unit, count * unit);
		for (let i = 0; i < count; i++) {
			const length = Math.min(chunkSize, ino.size - i * chunkSize);
			const low = u32le(table, i * unit + (indexed ? 4 : 0));
			if (low === NULL_ADDR) {
				yield* zeros(length);
				continue;
			}
			if (indexed && u16le(table, i * 8 + 2) !== 0)
				throw this.bad(ino.nid, `chunk ${i} is on an extra device`);
			// Indexed entries keep a 48-bit address's high bits in their first u16.
			const block = indexed ? u16le(table, i * 8) * 2 ** 32 + low : low;
			yield* readPieces(this.r, block * bs, length, STREAM_PIECE);
		}
	}

	/** Whole blocks at i_u, then a tail packed right after the inode, which may not cross a block. */
	private async *inline(ino: Inode): AsyncGenerator<Uint8Array> {
		const bs = this.sb.blockSize;
		const full = Math.floor(ino.size / bs) * bs;
		const tail = ino.size - full;
		if (tail > 0 && (ino.bodyEnd % bs) + tail > bs) throw this.bad(ino.nid, "inline tail crosses a block");
		if (full) yield* readPieces(this.r, ino.union * bs, full, STREAM_PIECE);
		if (tail) yield await this.r.read(ino.bodyEnd, tail);
	}

	size(ino: Inode): number {
		return ino.size;
	}

	async *stream(ino: Inode): AsyncGenerator<Uint8Array> {
		switch (ino.layout) {
			case "FLAT_PLAIN":
				// An empty file's i_u is not an address.
				if (ino.size > 0) yield* readPieces(this.r, ino.union * this.sb.blockSize, ino.size, STREAM_PIECE);
				return;
			case "FLAT_INLINE":
				return yield* this.inline(ino);
			case "CHUNK_BASED":
				return yield* this.chunked(ino);
			case "COMPRESSED_FULL":
			case "COMPRESSED_COMPACT":
				return yield* streamCompressed(
					this.r,
					{
						nid: ino.nid,
						size: ino.size,
						compact: ino.layout === "COMPRESSED_COMPACT",
						bodyEnd: ino.bodyEnd,
					},
					this.sb,
				);
		}
	}

	/** A directory block: n dirents of { u64 nid, u16 nameoff, u8 type, u8 }, then their names; n = first nameoff / 12. */
	async entries(dir: Inode): Promise<DirEntry[]> {
		const data = await collect(this.stream(dir), dir.size, `${this.r.label}: nid ${dir.nid}`);
		const out: DirEntry[] = [];
		for (let at = 0; at < data.length; at += this.sb.dirBlockSize) {
			const block = data.subarray(at, Math.min(data.length, at + this.sb.dirBlockSize));
			const first = u16le(block, 8);
			if (first < DIRENT || first % DIRENT !== 0 || first > block.length)
				throw this.bad(dir.nid, `dirent block at ${at} starts its names at ${first}`);
			const count = first / DIRENT;
			for (let i = 0; i < count; i++) {
				const start = u16le(block, i * DIRENT + 8);
				// The last name runs to the end of the block, NUL-padded.
				let end = i + 1 < count ? u16le(block, (i + 1) * DIRENT + 8) : block.length;
				if (start > end || end > block.length)
					throw this.bad(dir.nid, `dirent ${i} in block at ${at} has name bounds ${start}-${end}`);
				while (end > start && u8(block, end - 1) === 0) end--;
				const name = new TextDecoder().decode(block.subarray(start, end));
				if (name !== "." && name !== "..")
					out.push({
						name,
						inode: safeU64le(block, i * DIRENT),
						kind: kindOfDirent(u8(block, i * DIRENT + 10)),
					});
			}
		}
		return out;
	}
}

export async function openErofs(r: RangeSource): Promise<Filesystem> {
	const raw = await r.read(SUPERBLOCK_AT, SUPERBLOCK_SIZE);
	if (!isErofs(raw)) throw new FsError(`${r.label}: no EROFS superblock`);
	const blockBits = u8(raw, 12);
	const dirBlockBits = blockBits + u8(raw, 90);
	if (blockBits < MIN_BLOCK_BITS || dirBlockBits > MAX_BLOCK_BITS)
		throw new FsError(`${r.label}: EROFS blocks of 2^${blockBits}, directory blocks of 2^${dirBlockBits}`);
	const blockSize = 2 ** blockBits;
	return pathFilesystem(
		"erofs",
		new ErofsStore(r, {
			blockSize,
			rootNid: u16le(raw, 14),
			metaBlock: u32le(raw, 40),
			dirBlockSize: 2 ** dirBlockBits,
			zeroPadding: (u32le(raw, 80) & LZ4_0PADDING) !== 0,
		}),
	);
}
