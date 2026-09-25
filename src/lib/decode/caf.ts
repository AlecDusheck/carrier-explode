/** Core Audio Format header summary, per Apple's CAF File Specification. */

import { asciiAt, latin1 } from "./bytes";

export interface CafInfo {
  sampleRate: number;
  /** Four-character format ID, e.g. "lpcm", "aac ". */
  format: string;
  channels: number;
  bitsPerChannel: number;
  /** For lpcm: "float" or "int", plus endianness. */
  encoding?: string;
  /** Seconds, when the packet table or constant packet size allows it. */
  duration?: number;
}

const fourcc = (b: Uint8Array, off: number) => latin1(b.subarray(off, off + 4));

export function isCaf(b: Uint8Array): boolean {
  return b.length >= 8 && asciiAt(b, 0, "caff");
}

export function decodeCaf(b: Uint8Array): CafInfo {
  if (!isCaf(b)) throw new Error("not a CAF file");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let info: CafInfo | undefined;
  let bytesPerPacket = 0, framesPerPacket = 0, dataBytes = -1, validFrames = -1;
  // CAF spec: 8-byte file header, then chunks of type(4) + size(int64)
  for (let off = 8; off + 12 <= b.length; ) {
    const type = fourcc(b, off);
    const size = Number(dv.getBigInt64(off + 4));
    const body = off + 12;
    if (type === "desc" && body + 32 <= b.length) {
      const format = fourcc(b, body + 8);
      const flags = dv.getUint32(body + 12);
      bytesPerPacket = dv.getUint32(body + 16);
      framesPerPacket = dv.getUint32(body + 20);
      info = {
        sampleRate: dv.getFloat64(body),
        format,
        channels: dv.getUint32(body + 24),
        bitsPerChannel: dv.getUint32(body + 28),
        // CAF spec: kCAFLinearPCMFormatFlagIsFloat = 1, IsLittleEndian = 2
        encoding: format === "lpcm" ? `${flags & 1 ? "float" : "int"}, ${flags & 2 ? "little" : "big"}-endian` : undefined,
      };
    } else if (type === "pakt" && body + 16 <= b.length) {
      validFrames = Number(dv.getBigInt64(body + 8));
    } else if (type === "data") {
      dataBytes = (size < 0 ? b.length - body : size) - 4; // 4-byte edit count precedes the audio
    }
    if (size < 0) break;
    off = body + size;
  }
  if (!info) throw new Error("CAF file has no desc chunk");
  const frames = validFrames >= 0 ? validFrames : bytesPerPacket && framesPerPacket && dataBytes >= 0 ? (dataBytes / bytesPerPacket) * framesPerPacket : -1;
  if (frames >= 0 && info.sampleRate > 0) info.duration = Math.round((frames / info.sampleRate) * 1000) / 1000;
  return info;
}
