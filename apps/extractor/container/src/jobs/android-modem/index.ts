/**
 * android.modem: one device's OTA of one build -> its modem carrier configurations, one
 * `android.modem-config` archive each (ModemArchive).
 */

import { compareUtf8, packFiles } from "@carrier-explode/binary";
import { openFilesystem, openPartition, openPayload, openRemoteZip, type Filesystem, type Payload } from "@carrier-explode/firmware";
import type { ObjClaim } from "@carrier-explode/storage";
import { allOrThrow, fanOut } from "../../../../src/fan-out.ts";
import type { JobContext } from "../../job.ts";
import type { JobOutput } from "../../../../src/jobs.ts";
import { READ_CONCURRENCY } from "../shared/limits.ts";
import { payloadCodecs } from "../android-codecs.ts";
import { listed, tensorLabel, type ExtractedModem, type ModemImages } from "./archive.ts";
import { mediatekModem } from "./mediatek.ts";
import { qualcommModem } from "./qualcomm.ts";
import { MODEM_BINS, shannonModem } from "./shannon.ts";

const PROGRESS_EVERY = 20;

const openImage = async (payload: Payload, name: string): Promise<Filesystem> => openFilesystem(await openPartition(payload, name));

/** Qualcomm's NON-HLOS is FAT; a Tensor modem image holds images/<label>/ with MediaTek's mcf/ or Shannon's modem.bin(.gz). */
export async function familyModem(images: ModemImages): Promise<ExtractedModem> {
  if (images.modem.kind === "fat") return qualcommModem(images);
  const label = await tensorLabel(images.modem);
  if (await listed(images.modem, `images/${label}/mcf`)) return mediatekModem(images);
  if ((await listed(images.modem, `images/${label}`))?.some((e) => MODEM_BINS.has(e.name))) return shannonModem(images);
  throw new Error(`modem/images/${label} holds neither mcf/ nor modem.bin(.gz)`);
}

export async function androidModem(ctx: JobContext<"android.modem">): Promise<JobOutput<"android.modem">> {
  const { build, device, url } = ctx.spec.params;
  const started = Date.now();
  const zip = await openRemoteZip(url);
  const payload = await openPayload(zip, { decompressors: payloadCodecs });
  if (!payload.partition("modem")) {
    ctx.log(`${device} ${build}: no modem partition`);
    return { build, device, modem: null };
  }
  let vendor: Promise<Filesystem> | undefined;
  const images: ModemImages = { modem: await openImage(payload, "modem"), vendor: () => (vendor ??= openImage(payload, "vendor")) };
  const { family, firmware, archives } = await familyModem(images);

  let done = 0;
  const stored = allOrThrow("modem configs", await fanOut(archives, READ_CONCURRENCY, async (a): Promise<readonly [string, string]> => {
    const claim = { kind: "android.modem-config", origin: { kind: "image", release: build, device, path: a.path } } satisfies ObjClaim;
    const sha = await ctx.r2.putObj(packFiles(a.files), claim);
    if (++done % PROGRESS_EVERY === 0) await ctx.progress(done, archives.length, a.label);
    return [a.label, sha];
  }));
  const configs: Record<string, string> = Object.fromEntries(stored);
  await ctx.progress(archives.length, archives.length);
  const { bytes, requests } = zip.source.stats;
  ctx.log(`${device} ${build}: ${family} ${firmware}, ${archives.length} configs; fetched ${bytes} bytes in ${requests} requests, ${Date.now() - started} ms`);
  return { build, device, modem: { family, firmware, configs: Object.fromEntries(Object.entries(configs).sort(([a], [b]) => compareUtf8(a, b))) } };
}
