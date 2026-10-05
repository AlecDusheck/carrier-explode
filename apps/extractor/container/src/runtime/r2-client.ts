/** R2Client over R2's S3 API: bodies from memory or streamed from disk, multipart when large (lib-storage decides). */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, paginateListObjectsV2, S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import { sha256Hex } from "@carrier-explode/binary";
import { keys, type ObjMeta } from "@carrier-explode/storage";
import type { PutBody, R2Client } from "../job.ts";

export interface R2Config {
  /** `https://<account>.r2.cloudflarestorage.com`. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** Streamed: a modem package or bundle set may be large. */
async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const isMissing = (e: unknown): boolean => e instanceof NoSuchKey || e instanceof NotFound;

export function createR2Client(config: R2Config): R2Client {
  const s3 = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 does not take the SDK's default CRC trailers on every operation.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = config.bucket;

  const upload = async (key: string, body: PutBody, contentType?: string): Promise<void> => {
    const Body = typeof body === "string" || body instanceof Uint8Array ? body : createReadStream(body.file);
    await new Upload({ client: s3, params: { Bucket, Key: key, Body, ...(contentType ? { ContentType: contentType } : {}) } }).done();
  };

  const client: R2Client = {
    async get(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!res.Body) throw new Error(`${key}: no body`);
        const bytes = await res.Body.transformToByteArray();
        if (bytes.length !== res.ContentLength) throw new Error(`${key}: got ${bytes.length} of ${res.ContentLength ?? "?"} bytes`);
        return bytes;
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async getJson(key) {
      const bytes = await client.get(key);
      return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
    },
    async head(key) {
      try {
        const res = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        if (!res.LastModified) throw new Error(`${key}: no Last-Modified`);
        return { size: res.ContentLength ?? 0, uploaded: res.LastModified };
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async list(prefix) {
      const out: string[] = [];
      for await (const page of paginateListObjectsV2({ client: s3 }, { Bucket, Prefix: prefix })) {
        for (const o of page.Contents ?? []) if (o.Key !== undefined) out.push(o.Key);
      }
      return out;
    },
    put: upload,
    putJson: (key, value) => upload(key, JSON.stringify(value), "application/json"),
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async putObj(body, claim) {
      const sha = body instanceof Uint8Array ? await sha256Hex(body) : await sha256OfFile(body.file);
      if (!(await client.head(keys.obj(sha)))) await upload(keys.obj(sha), body);
      if (!(await client.head(keys.meta(sha)))) {
        const size = body instanceof Uint8Array ? body.length : (await stat(body.file)).size;
        const record: ObjMeta = { ...claim, sha, size, storedAt: new Date().toISOString() };
        await client.putJson(keys.meta(sha), record);
      }
      return sha;
    },
  };
  return client;
}
