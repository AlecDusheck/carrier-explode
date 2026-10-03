/**
 * Random access into one partition of a full payload. Filesystem reads cluster,
 * so a small LRU of decompressed operations turns many reads into few fetches.
 */

import { bytesToHex, sha256Hex } from "../binary/index.ts";
import type { Decompress } from "./codecs.ts";
import type { InstallOp, Payload } from "./payload.ts";

export class PartitionError extends Error {
  override name = "PartitionError";
}

/** Random access to a partition image, whatever stores it. */
export interface BlockReader {
  readonly label: string;
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface PartitionReaderOptions {
  /** Decompressed operations kept (default 16; Pixel ops are ~2 MB each). */
  readonly cacheOps?: number;
  /** Check each blob against its data_sha256_hash (default true). */
  readonly verify?: boolean;
}

/** One run of blocks written by one operation, at `opBlock` blocks into that operation's output. */
interface Run {
  readonly start: number;
  readonly count: number;
  readonly op: number;
  readonly opBlock: number;
}

/** Runs sorted by start block, from every operation's destination extents. */
function blockMap(ops: readonly InstallOp[]): Run[] {
  const runs: Run[] = [];
  ops.forEach((op, i) => {
    let opBlock = 0;
    for (const e of op.dstExtents) {
      runs.push({ start: e.startBlock, count: e.numBlocks, op: i, opBlock });
      opBlock += e.numBlocks;
    }
  });
  return runs.sort((a, b) => a.start - b.start);
}

/** The run holding `block`, by binary search. */
function runAt(runs: readonly Run[], block: number): Run | undefined {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid];
    if (r === undefined) break;
    if (block < r.start) hi = mid - 1;
    else if (block >= r.start + r.count) lo = mid + 1;
    else return r;
  }
  return undefined;
}

/** A partition of a payload as a BlockReader. Holds the op cache, so it is a class. */
export class PartitionReader implements BlockReader {
  readonly label: string;
  readonly size: number;
  private readonly payload: Payload;
  private readonly ops: readonly InstallOp[];
  private readonly runs: readonly Run[];
  private readonly cacheOps: number;
  private readonly verify: boolean;
  /** Insertion order is recency: a hit is deleted and re-set. In-flight loads are shared. */
  private readonly cache = new Map<number, Promise<Uint8Array>>();
  private loaded = 0;

  constructor(payload: Payload, name: string, opts: PartitionReaderOptions = {}) {
    const part = payload.partition(name);
    if (!part) throw new PartitionError(`no partition ${name} in ${payload.source.label}`);
    this.label = `${payload.source.label}:${name}`;
    this.size = part.size;
    this.payload = payload;
    this.ops = part.operations;
    this.runs = blockMap(part.operations);
    this.cacheOps = Math.max(1, opts.cacheOps ?? 16);
    this.verify = opts.verify ?? true;
  }

  /** Operations decompressed so far, cache hits excluded. */
  get opsLoaded(): number {
    return this.loaded;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.size) {
      throw new PartitionError(`${this.label}: read of ${length} at ${offset} is outside its ${this.size} bytes`);
    }
    const bs = this.payload.blockSize;
    const out = new Uint8Array(length);
    for (let done = 0; done < length; ) {
      const pos = offset + done;
      const block = Math.floor(pos / bs);
      const run = runAt(this.runs, block);
      if (!run) throw new PartitionError(`${this.label}: no operation writes block ${block}`);
      const data = await this.opOutput(run.op);
      const from = (run.opBlock + block - run.start) * bs + (pos % bs);
      const take = Math.min(length - done, (run.start + run.count) * bs - pos);
      out.set(data.subarray(from, from + take), done);
      done += take;
    }
    return out;
  }

  private opOutput(index: number): Promise<Uint8Array> {
    const hit = this.cache.get(index);
    if (hit) {
      this.cache.delete(index);
      this.cache.set(index, hit);
      return hit;
    }
    const load = this.load(index);
    // A failed load must not stay cached, or every later read would fail the same way.
    load.catch(() => this.cache.delete(index));
    this.cache.set(index, load);
    for (const oldest of this.cache.keys()) {
      if (this.cache.size <= this.cacheOps) break;
      this.cache.delete(oldest);
    }
    return load;
  }

  private decompressor(op: InstallOp, index: number): Decompress {
    const { xz, bz2, zstd } = this.payload.decompressors;
    switch (op.type) {
      case "REPLACE": return (b) => b;
      case "REPLACE_XZ": return xz;
      case "REPLACE_BZ": return bz2;
      case "REPLACE_ZSTD": return zstd;
      default: throw new PartitionError(`${this.label}: operation ${index} is ${op.type}; only full OTAs are readable`);
    }
  }

  private async load(index: number): Promise<Uint8Array> {
    const op = this.ops[index];
    if (!op) throw new PartitionError(`${this.label}: no operation ${index}`);
    const size = op.dstExtents.reduce((n, e) => n + e.numBlocks, 0) * this.payload.blockSize;
    this.loaded++;
    if (op.type === "ZERO" || op.type === "DISCARD") return new Uint8Array(size);
    const decompress = this.decompressor(op, index);
    const blob = await this.payload.source.read(this.payload.dataOffset + op.dataOffset, op.dataLength);
    if (this.verify && op.dataSha256) {
      const got = await sha256Hex(blob);
      if (got !== bytesToHex(op.dataSha256)) throw new PartitionError(`${this.label}: operation ${index} blob sha256 ${got} does not match the manifest`);
    }
    const data = await decompress(blob, size);
    if (data.length !== size) throw new PartitionError(`${this.label}: operation ${index} (${op.type}) produced ${data.length} bytes, expected ${size}`);
    return data;
  }
}

export function partitionReader(payload: Payload, name: string, opts?: PartitionReaderOptions): PartitionReader {
  return new PartitionReader(payload, name, opts);
}
