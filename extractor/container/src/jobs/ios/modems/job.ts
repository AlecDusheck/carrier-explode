/**
 * ios.modems: a build's modem packages, for every iPhone that received it: a
 * port of scripts/modems.py, modems.sh and baseband.ts. Each IPSW's directory
 * and BuildManifest are read over Range requests, packages grouped by (name,
 * size, CRC32), and each new one stored under obj/ (kind ios.bbfw or ios.ftab)
 * with its decoded summary at decoded/baseband/v<schema>/<sha>.json. A package
 * an earlier release already points at, with its summary in place, is not
 * fetched again. The output is Release.modems, which ios.release folds in.
 *
 * All or nothing: a package that cannot be read fails the job, and the
 * Workflow then runs ios.release without modems (v1's best-effort step) rather
 * than recording a list with a phone missing.
 */

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";

import { MANIFEST_URL, MODEM_SUMMARY_SCHEMA, parseManifest } from "../../../../../../src/lib/decode/index.ts";
import { openRemoteZip, type RemoteZip } from "../../../../../../src/lib/firmware/index.ts";
import { fetchWithRetry } from "../../../../../../src/lib/http/index.ts";
import { keys } from "../../../../../../src/lib/storage/keys.ts";
import type { JobContext, JobOutput, JobRunner, R2Client } from "../../../job.ts";
import { appledbFirmware, iphoneCatalog } from "../catalog.ts";
import { mapLimit } from "../map-limit.ts";
import { parseBuildManifest } from "../shared/build-manifest.ts";
import { fetchMember } from "./fetch.ts";
import { group, modemMembers, packageKey, type ModemGroup, type ModemMember } from "./group.ts";
import { modemSummary } from "./summary.ts";

/** Apple's CDN is shared: a few IPSW directories at a time. */
const CONCURRENCY = 4;
const SUMMARY_KIND = "baseband";

/**
 * Release.modems entry: the v1 ImageModem shape (src/lib/server/timeline.ts), package.id being the
 * sha256. A type alias rather than an interface, so it is assignable to the output's Json.
 */
type ImageModem = {
  family: string;
  package: { id: string; size: number; name: string; crc32: string; kind: "bbfw" | "ftab" };
  devices: string[];
};

const ImageModemSchema = v.object({
  family: v.string(),
  package: v.object({ id: v.string(), size: v.number(), name: v.string(), crc32: v.string(), kind: v.picklist(["bbfw", "ftab"]) }),
  devices: v.array(v.string()),
});
/** A release without modems is one whose ios.modems run failed. */
const ReleaseModems = v.looseObject({ modems: v.optional(v.array(ImageModemSchema)) });

/** Packages earlier releases point at, by packageKey. */
async function knownPackages(r2: R2Client): Promise<Map<string, ImageModem>> {
  const out = new Map<string, ImageModem>();
  const releases = (await r2.list(keys.releasesPrefix("ios"))).filter((k) => k.endsWith(".json"));
  await mapLimit(releases, 8, async (key) => {
    for (const m of v.parse(ReleaseModems, await r2.getJson(key)).modems ?? []) out.set(packageKey(m.package), m);
  });
  return out;
}

/**
 * The OTA manifest's carrier table, which maps bbfw band-combo tags to
 * bundles. Required: a summary stored without it would never be redone, since
 * a stored package is not decoded again; an outage fails the job, and the
 * Workflow's retry or the next run does it whole.
 */
async function carrierTable(): Promise<unknown> {
  const bytes = new Uint8Array(await (await fetchWithRetry(MANIFEST_URL)).arrayBuffer());
  const table = parseManifest(bytes).MobileDeviceCarriersByMccMnc;
  if (table === undefined) throw new Error("carrier manifest has no MobileDeviceCarriersByMccMnc");
  return table;
}

/** Both the package and its summary are in the bucket. */
async function isStored(r2: R2Client, sha: string): Promise<boolean> {
  const [obj, summary] = await Promise.all([r2.head(keys.obj(sha)), r2.head(keys.decoded(SUMMARY_KIND, MODEM_SUMMARY_SCHEMA, sha))]);
  return obj !== null && summary !== null;
}

interface Listing {
  readonly zip: RemoteZip;
  readonly members: readonly ModemMember[];
}

async function listing(url: string): Promise<Listing> {
  const zip = await openRemoteZip(url);
  const entry = zip.entry("BuildManifest.plist");
  if (!entry) throw new Error(`${url} has no BuildManifest.plist`);
  return { zip, members: modemMembers(zip.entries, parseBuildManifest(await zip.read(entry))) };
}

/** Fetches, stores and decodes one package; returns its sha and family. */
async function storePackage(ctx: JobContext<"ios.modems">, g: ModemGroup, zip: RemoteZip, mccMnc: () => Promise<unknown>): Promise<{ id: string; family: string }> {
  const entry = zip.entry(g.member);
  if (!entry) throw new Error(`${g.url} lost ${g.member}`);
  const file = join(ctx.tmp, `package.${g.kind}`);
  try {
    await fetchMember(zip, g.url, entry, file);
    const id = await ctx.r2.putObj({ file }, { kind: g.kind === "bbfw" ? "ios.bbfw" : "ios.ftab", origin: { url: g.url, release: ctx.spec.params.build, path: g.member } });
    const summary = modemSummary(new Uint8Array(await readFile(file)), g.name, g.kind === "bbfw" ? await mccMnc() : undefined);
    const family = summary.package.family;
    if (!family) throw new Error(`${g.name}: no modem family in the name`);
    await ctx.r2.putJson(keys.decoded(SUMMARY_KIND, MODEM_SUMMARY_SCHEMA, id), summary);
    ctx.log(`${g.name}: stored ${id.slice(0, 12)}, ${family} (${summary.kind})`);
    return { id, family };
  } finally {
    await rm(file, { force: true });
  }
}

export const runModems: JobRunner<"ios.modems"> = async (ctx): Promise<JobOutput<"ios.modems">> => {
  const { build, ipsws } = ctx.spec.params;
  const catalog = await iphoneCatalog();

  // Phones per IPSW: the planner lists each file once, under one phone; the catalogue knows the
  // rest (ipsw.me for releases, AppleDB for the betas ipsw.me does not list).
  const pairs = catalog.byBuild.get(build) ?? [...(await appledbFirmware(build)).ipsws].map(([device, url]) => ({ device, url }));
  const serves = new Map<string, string[]>();
  for (const i of ipsws) {
    const sharing = pairs.filter((p) => p.url === i.url).map((p) => p.device);
    serves.set(i.url, [...new Set([i.device, ...sharing])]);
  }
  const urls = [...serves.keys()];
  const listings = new Map(await mapLimit(urls, CONCURRENCY, async (url) => [url, await listing(url)] as const));
  const groups = group(serves, new Map([...listings].map(([u, l]) => [u, l.members])), catalog.boards);

  const known = await knownPackages(ctx.r2);
  let table: Promise<unknown> | undefined;
  const mccMnc = (): Promise<unknown> => (table ??= carrierTable());

  const modems: ImageModem[] = [];
  for (const g of groups) {
    const prior = known.get(packageKey(g));
    const reused = prior && (await isStored(ctx.r2, prior.package.id)) ? { id: prior.package.id, family: prior.family } : undefined;
    const zip = listings.get(g.url)?.zip;
    if (!zip) throw new Error(`${g.url}: listed but not opened`);
    const { id, family } = reused ?? (await storePackage(ctx, g, zip, mccMnc));
    modems.push({ family, package: { id, size: g.size, name: g.name, crc32: g.crc32, kind: g.kind }, devices: [...g.devices] });
    await ctx.progress(modems.length, groups.length, g.name);
  }
  ctx.log(`${build}: ${modems.length} modem packages for ${urls.length} IPSWs`);
  return { modems };
};
