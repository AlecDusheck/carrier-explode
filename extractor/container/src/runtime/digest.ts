/** sha256 of an upload body. Files are hashed streaming (node:crypto): a modem package or bundle set may be large. */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import { sha256Hex } from "../../../../src/lib/binary/index.ts";

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export const sha256Of = (body: Uint8Array | { readonly file: string }): Promise<string> =>
  body instanceof Uint8Array ? sha256Hex(body) : sha256OfFile(body.file);
