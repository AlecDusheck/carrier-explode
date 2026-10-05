/** An Apple bundle's bytes at one version (catalog.ts Ver), from obj/<sha>, opened once per request. */

import { error } from "@sveltejs/kit";
import { decodeFile, decodedPlist, decodedPri, isJsonDict, openIpcc, type OpenedBundle, type PriDecoded } from "@carrier-explode/decode-ios";
import { keys } from "@carrier-explode/storage";
import { decoderFamily, type TimelineEntry } from "@carrier-explode/schema/types";
import type { PhoneFile } from "#lib/apple/phones.ts";
import { perRequest } from "../cache";
import { resolve, verFrom, type Resolved } from "../catalog";
import { withPhones } from "./boards";
import type { Ver } from "#lib/types.ts";
import { readBytes } from "../store";

/** Where Apple serves a version: its first OTA copy. */
export const upstream = (e: TimelineEntry): string | undefined => e.copies.flatMap((c) => (c.kind === "ota" ? [c.url] : []))[0];

async function bytesOf(e: TimelineEntry): Promise<Uint8Array<ArrayBuffer>> {
  const held = await readBytes(keys.obj(e.sha));
  if (!held) error(500, `obj/${e.sha} is indexed but missing from the bucket.`);
  return held;
}

export interface Digested {
  readonly sha256: string;
  readonly sha384: string;
  readonly sha1: string;
}

/** The stored bytes against the strongest digest Apple's manifest states for them; null when it states none (image copies). */
export function verify(e: TimelineEntry, got: Digested): boolean | null {
  const stated = e.copies.flatMap((c) => (c.kind === "ota" ? [c.digests] : []))[0];
  if (stated?.sha384 !== undefined) return stated.sha384 === got.sha384;
  if (stated?.sha1 !== undefined) return stated.sha1 === got.sha1;
  return null;
}

export interface Opened extends Resolved {
  readonly opened: OpenedBundle;
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The bundle's files, each override file with the phones its boards are. */
  readonly files: readonly PhoneFile[];
}

/** A version's bytes and zip index. Several queries of one page read the same bundle, so it is opened once per request. */
const openOnce = perRequest(async (source: string, line: string, slug: string): Promise<Opened> => {
  const r = await resolve(verFrom(source, line, slug));
  if (decoderFamily(r.ref.platform) !== "apple") error(400, `${source} is not an Apple bundle.`);
  const bytes = await bytesOf(r.entry);
  const opened = openIpcc(bytes);
  return { ...r, opened, bytes, files: await withPhones(opened.info.files) };
});
export const open = (v: Ver): Promise<Opened> => openOnce(v.source, v.line ?? "", v.slug ?? "");

/** A decoded .der.pri, or undefined when the file is not one: callers skip what does not decode, as the phone would. */
export function readPri(opened: OpenedBundle, path: string): PriDecoded | undefined {
  try {
    return decodedPri(decodeFile(opened, path));
  } catch {
    return undefined;
  }
}

/** A member plist as a dictionary, or undefined when it is absent or not one. */
export function plistOf(opened: OpenedBundle, path: string): Record<string, unknown> | undefined {
  if (!opened.info.files.some((f) => f.path === path)) return undefined;
  try {
    const v = decodedPlist(decodeFile(opened, path));
    return isJsonDict(v) ? v : undefined;
  } catch {
    // Shown as undecodable in Files, with the reason; here it is only absent.
    return undefined;
  }
}
