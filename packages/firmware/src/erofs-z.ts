/**
 * EROFS compressed files (linux fs/erofs/zmap.c and decompressor.c): the logical clusters' index, full or compact,
 * mapped to physical clusters, each decompressed with LZ4. Tail packing, fragments and other algorithms are refused.
 */

import { decodeLz4Into, u16le, u32le } from "@carrier-explode/binary";
import { FsError } from "./fs.ts";
import type { RangeSource } from "./source.ts";

/** z_erofs_map_header.h_advise. */
const COMPACTED_2B = 0x1;
const BIG_PCLUSTER_1 = 0x2;
const INLINE_PCLUSTER = 0x8;
const INTERLACED_PCLUSTER = 0x10;
const FRAGMENT_PCLUSTER = 0x20;
/** A NONHEAD lcluster's delta[0] with this bit holds its pcluster's block count. */
const D0_CBLKCNT = 1 << 11;
const MAP_HEADER = 8;

const LCLUSTER_TYPES = ["PLAIN", "HEAD1", "NONHEAD", "HEAD2"] as const;
type LclusterType = (typeof LCLUSTER_TYPES)[number];
const ALGORITHMS = ["lz4", "lzma", "deflate", "zstd"] as const;

/** One logical cluster as the index records it. */
interface Lcluster {
	readonly type: LclusterType;
	/** A head's offset into its lcluster where its pcluster's data starts. */
	readonly clusterofs: number;
	/** A head's first block. */
	readonly pblk: number;
	/** A NONHEAD's distance back to its head. */
	readonly delta0: number;
	/** A NONHEAD right after a big pcluster's head: the pcluster's block count. */
	readonly compressedBlocks: number | undefined;
}

export interface CompressedInode {
	readonly nid: number;
	readonly size: number;
	readonly compact: boolean;
	/** Where the inode and its xattrs end: the map header is at the next 8-byte boundary. */
	readonly bodyEnd: number;
}

export class ErofsCompressedError extends FsError {
	override name = "ErofsCompressedError";
}

const align = (n: number, to: number): number => Math.ceil(n / to) * to;

/** decode_compactedbits: `lobits` of value, then a 2-bit type, at bit `pos` of `pack`. */
function compacted(
	pack: Uint8Array,
	pos: number,
	lobits: number,
): { readonly lo: number; readonly type: LclusterType } {
	const at = pos >> 3;
	const word =
		((pack[at] ?? 0) |
			((pack[at + 1] ?? 0) << 8) |
			((pack[at + 2] ?? 0) << 16) |
			((pack[at + 3] ?? 0) << 24)) >>>
		(pos & 7);
	return { lo: word & ((1 << lobits) - 1), type: LCLUSTER_TYPES[(word >>> lobits) & 3] ?? "PLAIN" };
}

/** A file's logical clusters, each read as the kernel's z_erofs_load_*_lcluster does. */
class Index {
	constructor(
		private readonly r: RangeSource,
		private readonly ino: CompressedInode,
		private readonly advise: number,
		private readonly lclusterBits: number,
		private readonly count: number,
	) {}

	private get bigPcluster(): boolean {
		return (this.advise & BIG_PCLUSTER_1) !== 0;
	}

	private bad(why: string): FsError {
		return new FsError(`${this.r.label}: nid ${this.ino.nid}: ${why}`);
	}

	async load(lcn: number): Promise<Lcluster> {
		if (lcn >= this.count) throw this.bad(`lcluster ${lcn} past the ${this.count} the file has`);
		return this.ino.compact ? this.compact(lcn) : this.full(lcn);
	}

	/** z_erofs_load_full_lcluster: 8-byte entries after the map header and an 8-byte reserved slot. */
	private async full(lcn: number): Promise<Lcluster> {
		const pos = align(this.ino.bodyEnd, 8) + MAP_HEADER + 8 + lcn * 8;
		const e = await this.r.read(pos, 8);
		const type = LCLUSTER_TYPES[u16le(e, 0) & 3] ?? "PLAIN";
		if (type === "NONHEAD") {
			const d0 = u16le(e, 4);
			if (d0 & D0_CBLKCNT) {
				if (!this.bigPcluster) throw this.bad(`lcluster ${lcn} counts blocks without big pclusters`);
				return {
					type,
					clusterofs: 1 << this.lclusterBits,
					pblk: 0,
					delta0: 1,
					compressedBlocks: d0 & ~D0_CBLKCNT,
				};
			}
			return { type, clusterofs: 1 << this.lclusterBits, pblk: 0, delta0: d0, compressedBlocks: undefined };
		}
		return { type, clusterofs: u16le(e, 2), pblk: u32le(e, 4), delta0: 0, compressedBlocks: undefined };
	}

	/** z_erofs_load_compact_lcluster: packs of 2 (4-byte) or 16 (2-byte) entries, each pack ending in a base block address. */
	private async compact(lcn: number): Promise<Lcluster> {
		const ebase = align(this.ino.bodyEnd, 8) + MAP_HEADER;
		const initial4b = Math.floor((32 - (ebase % 32)) / 4) & 7;
		const compacted2b =
			this.advise & COMPACTED_2B && initial4b < this.count
				? Math.floor((this.count - initial4b) / 16) * 16
				: 0;
		let pos = ebase;
		let shift = 2;
		let n = lcn;
		if (n >= initial4b) {
			pos += initial4b * 4;
			n -= initial4b;
			if (n < compacted2b) shift = 1;
			else {
				pos += compacted2b * 2;
				n -= compacted2b;
			}
		}
		pos += n << shift;
		const vcnt = shift === 2 && this.lclusterBits <= 14 ? 2 : shift === 1 && this.lclusterBits <= 12 ? 16 : 0;
		if (vcnt === 0)
			throw this.bad(`compact indexes of 2^${shift} bytes for 2^${this.lclusterBits}-byte lclusters`);
		const packSize = vcnt << shift;
		const packStart = pos - (pos % packSize);
		const pack = await this.r.read(packStart, packSize);
		const lobits = Math.max(this.lclusterBits, 12);
		const encodebits = ((packSize - 4) * 8) / vcnt;
		let i = (pos - packStart) >> shift;
		const at = (k: number): { readonly lo: number; readonly type: LclusterType } =>
			compacted(pack, encodebits * k, lobits);
		const { lo, type } = at(i);
		if (type === "NONHEAD") {
			const clusterofs = 1 << this.lclusterBits;
			if (lo & D0_CBLKCNT) {
				if (!this.bigPcluster) throw this.bad(`lcluster ${lcn} counts blocks without big pclusters`);
				return { type, clusterofs, pblk: 0, delta0: 1, compressedBlocks: lo & ~D0_CBLKCNT };
			}
			if (i + 1 !== vcnt) return { type, clusterofs, pblk: 0, delta0: lo, compressedBlocks: undefined };
			// A pack's last lcluster saves delta[1] instead: delta[0] comes from the one before it.
			const prev = at(i - 1);
			const d = prev.type !== "NONHEAD" ? 0 : prev.lo & D0_CBLKCNT ? 1 : prev.lo;
			return { type, clusterofs, pblk: 0, delta0: d + 1, compressedBlocks: undefined };
		}
		let nblk = this.bigPcluster ? 0 : 1;
		while (i > 0) {
			i--;
			const p = at(i);
			if (this.bigPcluster) {
				if (p.type === "NONHEAD") {
					if (p.lo & D0_CBLKCNT) {
						i--;
						nblk += p.lo & ~D0_CBLKCNT;
						continue;
					}
					if (p.lo <= 1) throw this.bad(`lcluster ${lcn}'s pack has a big pcluster's delta of ${p.lo}`);
					i -= p.lo - 2;
					continue;
				}
				nblk++;
			} else {
				if (p.type === "NONHEAD") i -= p.lo;
				if (i >= 0) nblk++;
			}
		}
		return {
			type,
			clusterofs: lo,
			pblk: u32le(pack, packSize - 4) + nblk,
			delta0: 0,
			compressedBlocks: undefined,
		};
	}
}

/** One physical cluster's share of the file: logical bytes [start, end) from `blocks` blocks at `pblk`. */
interface Extent {
	readonly start: number;
	readonly end: number;
	readonly type: LclusterType;
	readonly pblk: number;
	readonly blocks: number;
}

export interface ZOptions {
	readonly blockSize: number;
	/** LZ4_0PADDING: compressed data sits at the end of its blocks, after zeros. */
	readonly zeroPadding: boolean;
}

/** Every byte of a compressed file, a physical cluster at a time. */
export async function* streamCompressed(
	r: RangeSource,
	ino: CompressedInode,
	opts: ZOptions,
): AsyncGenerator<Uint8Array> {
	if (ino.size === 0) return;
	const header = await r.read(align(ino.bodyEnd, 8), MAP_HEADER);
	const advise = u16le(header, 4);
	const algorithms = [ALGORITHMS[(header[6] ?? 0) & 0xf], ALGORITHMS[(header[6] ?? 0) >> 4]];
	const lclusterBits = Math.log2(opts.blockSize) + ((header[7] ?? 0) & 7);
	const bad = (why: string): ErofsCompressedError =>
		new ErofsCompressedError(`${r.label}: nid ${ino.nid}: ${why}`);
	if (advise & (INLINE_PCLUSTER | FRAGMENT_PCLUSTER))
		throw bad(`advise ${advise.toString(16)}: tail-packed or fragment pclusters`);
	const lsize = 2 ** lclusterBits;
	const index = new Index(r, ino, advise, lclusterBits, Math.ceil(ino.size / lsize));

	const extents: Extent[] = [];
	const count = Math.ceil(ino.size / lsize);
	for (let lcn = 0; lcn < count; lcn++) {
		const l = await index.load(lcn);
		if (l.type === "NONHEAD") continue;
		const start = lcn * lsize + l.clusterofs;
		const next = lcn + 1 < count ? await index.load(lcn + 1) : undefined;
		const blocks =
			(advise & BIG_PCLUSTER_1) !== 0 && next?.compressedBlocks !== undefined ? next.compressedBlocks : 1;
		const prev = extents.at(-1);
		if (prev !== undefined) extents[extents.length - 1] = { ...prev, end: start };
		extents.push({ start, end: ino.size, type: l.type, pblk: l.pblk, blocks });
	}
	const first = extents[0];
	if (first === undefined || first.start !== 0) throw bad("its first lcluster is not a head at offset 0");

	for (const e of extents) {
		if (e.end <= e.start) continue;
		const length = e.end - e.start;
		const raw = await r.read(e.pblk * opts.blockSize, e.blocks * opts.blockSize);
		if (e.type === "PLAIN") {
			// An interlaced plain pcluster is rotated by its logical start within a block.
			const shift = advise & INTERLACED_PCLUSTER ? e.start % opts.blockSize : 0;
			const plain = shift ? new Uint8Array([...raw.subarray(shift), ...raw.subarray(0, shift)]) : raw;
			if (length > plain.length) throw bad(`a plain pcluster of ${plain.length} bytes for ${length}`);
			yield plain.subarray(0, length);
			continue;
		}
		const algorithm = algorithms[e.type === "HEAD1" ? 0 : 1];
		if (algorithm !== "lz4") throw bad(`a ${algorithm ?? "unknown"} pcluster`);
		let from = 0;
		if (opts.zeroPadding) while (from < raw.length && raw[from] === 0) from++;
		const out = new Uint8Array(length);
		// A cluster is decoded only as far as the file needs.
		const data = out.subarray(0, decodeLz4Into(raw.subarray(from), out, 0, true));
		if (data.length !== length) throw bad(`a pcluster decoded to ${data.length} of ${length} bytes`);
		yield data;
	}
}
