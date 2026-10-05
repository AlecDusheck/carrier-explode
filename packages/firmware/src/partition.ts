/** Random access into one partition of a full payload. Filesystem reads cluster, so an LRU of decompressed operations saves fetches. */

import { bytesToHex, sha256Hex } from "@carrier-explode/binary";
import type { Decompress } from "./codecs.ts";
import type { InstallOp, Payload } from "./payload.ts";
import { checkRange, type RangeSource } from "./source.ts";

export class PartitionError extends Error {
  override name = "PartitionError";
}

/** The payload has no such partition: older Pixels have no product partition, for one. */
export class MissingPartitionError extends PartitionError {
  override name = "MissingPartitionError";
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
  return ops
    .flatMap((op, i) => {
      let opBlock = 0;
      return op.dstExtents.map((e) => {
        const run = { start: e.startBlock, count: e.numBlocks, op: i, opBlock };
        opBlock += e.numBlocks;
        return run;
      });
    })
    .sort((a, b) => a.start - b.start);
}

/** The run holding `block`, by binary search. */
function runAt(runs: readonly Run[], block: number): Run | undefined {
  for (let lo = 0, hi = runs.length - 1; lo <= hi; ) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid];
    if (r === undefined) return undefined;
    if (block < r.start) hi = mid - 1;
    else if (block >= r.start + r.count) lo = mid + 1;
    else return r;
  }
  return undefined;
}

const zeroWrite = (op: InstallOp): boolean => op.type === "ZERO" || op.type === "DISCARD";

/** Holds the op cache, so it is a class. */
class PartitionReader implements RangeSource {
  readonly label: string;
  readonly size: number;
  private readonly payload: Payload;
  private readonly ops: readonly InstallOp[];
  private readonly runs: readonly Run[];
  private readonly cacheOps: number;
  /** Insertion order is recency: a hit is deleted and re-set. In-flight loads are shared. */
  private readonly cache = new Map<number, Promise<Uint8Array>>();

  constructor(payload: Payload, name: string, cacheOps: number) {
    const part = payload.partition(name);
    if (!part) throw new MissingPartitionError(`no partition ${name} in ${payload.source.label}`);
    this.label = `${payload.source.label}:${name}`;
    this.size = part.size;
    this.payload = payload;
    this.ops = part.operations;
    this.runs = blockMap(part.operations);
    this.cacheOps = cacheOps;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    checkRange(this, offset, length);
    const bs = this.payload.blockSize;
    const out = new Uint8Array(length);
    for (let done = 0; done < length; ) {
      const pos = offset + done;
      const block = Math.floor(pos / bs);
      const run = runAt(this.runs, block);
      if (!run) throw new PartitionError(`${this.label}: no operation writes block ${block}`);
      const take = Math.min(length - done, (run.start + run.count) * bs - pos);
      const op = this.op(run.op);
      // `out` starts zeroed, so zero writes cost nothing.
      if (!zeroWrite(op)) {
        const from = (run.opBlock + block - run.start) * bs + (pos % bs);
        out.set((await this.output(run.op, op)).subarray(from, from + take), done);
      }
      done += take;
    }
    return out;
  }

  private op(index: number): InstallOp {
    const op = this.ops[index];
    if (!op) throw new PartitionError(`${this.label}: no operation ${index}`);
    return op;
  }

  private output(index: number, op: InstallOp): Promise<Uint8Array> {
    const hit = this.cache.get(index);
    if (hit) {
      this.cache.delete(index);
      this.cache.set(index, hit);
      return hit;
    }
    const load = this.load(index, op);
    this.cache.set(index, load);
    // A failed load must not stay cached, or every later read would fail the same way.
    load.catch(() => {
      if (this.cache.get(index) === load) this.cache.delete(index);
    });
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

  private async load(index: number, op: InstallOp): Promise<Uint8Array> {
    const decompress = this.decompressor(op, index);
    const size = op.dstExtents.reduce((n, e) => n + e.numBlocks, 0) * this.payload.blockSize;
    const blob = await this.payload.source.read(this.payload.dataOffset + op.dataOffset, op.dataLength);
    if (op.dataSha256) {
      const got = await sha256Hex(blob);
      if (got !== bytesToHex(op.dataSha256)) throw new PartitionError(`${this.label}: operation ${index} blob sha256 ${got} does not match the manifest`);
    }
    const data = await decompress(blob, size);
    if (data.length !== size) throw new PartitionError(`${this.label}: operation ${index} (${op.type}) produced ${data.length} bytes, expected ${size}`);
    return data;
  }
}

/** One partition of a full payload, as a random-access source keeping `cacheOps` decompressed operations. */
export function partitionReader(payload: Payload, name: string, cacheOps = 16): RangeSource {
  return new PartitionReader(payload, name, cacheOps);
}
