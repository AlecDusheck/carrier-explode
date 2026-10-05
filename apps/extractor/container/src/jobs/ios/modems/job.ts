/** ios.modems: a build's modem packages for every iPhone, read by Range from each IPSW and stored once each, with a decoded summary. */

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { keys } from "@carrier-explode/storage";
import { allOrThrow, fanOut } from "../../../../../src/fan-out.ts";
import type { JobContext, JobRunner } from "../../../job.ts";
import type { JobOutput } from "../../../../../src/jobs.ts";
import { readReleases } from "../../shared/catalog.ts";
import { appledbFirmware, CATALOG_CONCURRENCY, iphoneCatalog } from "../../../../../src/feeds/apple-ipsw/catalog.ts";
import { fetchMember } from "../fetch-member.ts";
import { openIpsw, type RemoteIpsw } from "../remote-ipsw.ts";
import { group, modemMembers, packageKey, type ModemGroup } from "./group.ts";
import { carrierTable, modemSummary, summaryKey } from "./summary.ts";

type OutputModem = JobOutput<"ios.modems">["modems"][number];

interface Stored {
  readonly sha: string;
  readonly family: string;
}

/** Packages earlier releases list, by packageKey. */
async function knownPackages(ctx: JobContext<"ios.modems">): Promise<Map<string, Stored>> {
  const out = new Map<string, Stored>();
  for (const r of await readReleases(ctx.r2, "ios")) for (const m of r.modems) out.set(packageKey(m.package), { sha: m.package.sha, family: m.family });
  return out;
}

async function isStored(ctx: JobContext<"ios.modems">, sha: string): Promise<boolean> {
  const [obj, summary] = await Promise.all([ctx.r2.head(keys.obj(sha)), ctx.r2.head(summaryKey(sha))]);
  return obj !== null && summary !== null;
}

async function storePackage(ctx: JobContext<"ios.modems">, g: ModemGroup, ipsw: RemoteIpsw, device: string, mccMnc: ReturnType<typeof carrierTable>): Promise<Stored> {
  const entry = ipsw.zip.entry(g.member);
  if (!entry) throw new Error(`${ipsw.url} lost ${g.member}`);
  const file = join(ctx.tmp, `package.${g.kind}`);
  try {
    await fetchMember(ipsw.zip, ipsw.url, entry, file);
    const origin = { kind: "image", release: ctx.spec.params.build, device, path: g.member } as const;
    const sha = await ctx.r2.putObj({ file }, { kind: g.kind === "bbfw" ? "apple.bbfw" : "apple.ftab", origin });
    const summary = await modemSummary(new Uint8Array(await readFile(file)), g.name, mccMnc);
    const family = summary.package.family;
    if (!family) throw new Error(`${g.name}: no modem family in the name`);
    await ctx.r2.putJson(summaryKey(sha), summary);
    ctx.log(`${g.name}: stored ${sha}`);
    return { sha, family };
  } finally {
    await rm(file, { force: true });
  }
}

export const runModems: JobRunner<"ios.modems"> = async (ctx): Promise<JobOutput<"ios.modems">> => {
  const { build, ipsws } = ctx.spec.params;
  const catalog = await iphoneCatalog();
  // The plan lists each file once, under one phone; the catalogues know every phone sharing it (AppleDB for betas).
  const pairs = catalog.byBuild.get(build) ?? [...(await appledbFirmware(build)).ipsws].map(([device, url]) => ({ device, url }));
  const serves = new Map(ipsws.map((i) => [i.url, [...new Set([i.device, ...pairs.filter((p) => p.url === i.url).map((p) => p.device)])]]));
  const planned = new Map(ipsws.map((i) => [i.url, i.device]));

  const opened = allOrThrow("IPSWs", await fanOut([...serves.keys()], CATALOG_CONCURRENCY, openIpsw));
  const byUrl = new Map(opened.map((o) => [o.url, o]));
  const groups = group(serves, new Map(opened.map((o) => [o.url, modemMembers(o.zip.entries, o.manifest)])), catalog.boards);
  const known = await knownPackages(ctx);
  const mccMnc = carrierTable(ctx.r2);

  const modems: OutputModem[] = [];
  for (const g of groups) {
    const ipsw = byUrl.get(g.url);
    const device = planned.get(g.url);
    if (!ipsw || !device) throw new Error(`${g.url}: listed but not opened`);
    const prior = known.get(packageKey(g));
    const stored = prior && (await isStored(ctx, prior.sha)) ? prior : await storePackage(ctx, g, ipsw, device, mccMnc);
    modems.push({ family: stored.family, devices: [...g.devices], package: { kind: g.kind, name: g.name, sha: stored.sha, size: g.size, crc32: g.crc32 } });
    await ctx.progress(modems.length, groups.length, g.name);
  }
  return { modems };
};
