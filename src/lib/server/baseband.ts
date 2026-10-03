/**
 * iOS modem packages: each release's packages (Release.modems, one per modem
 * family) and their decoded summaries (decoded/baseband/v<N>/<id>.json, written
 * by the extractor's ios.modems job). The builds pages and a bundle's Modem tab
 * read these.
 */

import { error } from "@sveltejs/kit";
import * as v from "valibot";
import {
  MODEM_SUMMARY_SCHEMA, basebandComparable, byNewest, diffKeyed, parseBandCombos, summariseDiff,
  type BasebandSummary, type DiffCounts, type FtabSummary, type ModemKind, type ModemSummary,
} from "#lib/decode/index.ts";
import { countryName, splitName } from "#lib/names.ts";
import type { BasebandDiffPart } from "#lib/types.ts";
import { plmnTable } from "./apple";
import { cached, perRequest } from "./cache";
import { releaseList } from "./catalog";
import { modemView, summaryKey, type ModemView } from "./modems";
import { releaseModems } from "./releases";
import { etagOf, readJson } from "./store";
import type { ImageModem } from "./records";
import { keys } from "#lib/storage/keys.ts";

const KEEP = 30 * 86400;

/**
 * Summaries are our own decoder's output, stored under a key versioned by
 * MODEM_SUMMARY_SCHEMA, so the package header and kind are checked and the
 * rest is taken as that schema's shape.
 */
const summaryHead = v.looseObject({ kind: v.picklist(["bbfw", "ftab"]), package: v.looseObject({ id: v.string() }) });
const modemSummary = perRequest(async (id: string): Promise<ModemSummary | null> => {
  const head = await readJson(summaryKey(id), summaryHead);
  // Validated above: the discriminant and header; the body is MODEM_SUMMARY_SCHEMA's by its key.
  return head as ModemSummary | null;
});

async function mustSummary(id: string): Promise<ModemSummary> {
  const s = await modemSummary(id);
  if (!s) error(404, `No summary for modem package ${id}.`);
  return s;
}

async function mustBbfw(id: string): Promise<BasebandSummary> {
  const s = await mustSummary(id);
  if (s.kind !== "bbfw") error(404, `${id} is not a .bbfw package`);
  return s;
}

/** The release's package of `family`. */
async function releaseModem(build: string, family: string, kind: ModemKind): Promise<{ version: string; m: ImageModem }> {
  const { release, modems } = await releaseModems(build);
  const m = modems.find((x) => x.family === family && x.package.kind === kind);
  if (!m) error(404, `iOS ${release.version} (${build}) has no ${family} ${kind === "bbfw" ? ".bbfw" : "ftab"} modem package.`);
  return { version: release.version, m };
}

export interface BuildModems {
  readonly build: string;
  readonly version: string;
  readonly modems: readonly ModemView[];
}

/** A build's modem packages, one per distinct package, with the phones each serves; newest phones first. */
export async function getModems(build: string): Promise<BuildModems> {
  const { release, modems } = await releaseModems(build);
  return { build, version: release.version, modems: byNewest(modems.map(modemView)) };
}

export interface BuildFamilies {
  readonly build: string;
  readonly version: string;
  readonly families: readonly string[];
}

/** Every iOS release, newest first, and the modem families it holds. Kept as long as the release list is the same. */
export const basebandBuilds = perRequest(async (): Promise<BuildFamilies[]> => {
  const tag = await etagOf(keys.releases());
  return cached(`basebandbuilds:v1:${tag ?? "none"}`, KEEP, async () => {
    const ios = (await releaseList()).filter((r) => r.platform === "ios");
    return Promise.all(ios.map(async (r) => ({
      build: r.id, version: r.version, families: (await releaseModems(r.id)).modems.map((m) => m.family),
    })));
  });
});

type MccCountries = Record<string, { cc: string; name: string | undefined }>;

type SummaryFile = BasebandSummary["files"][number];
type NvRecord = BasebandSummary["nv"][number]["records"][number];

/** A .bbfw package as its pages read it: file contents and NV values stay on the server until asked for. */
export interface BbfwView {
  readonly kind: "bbfw";
  readonly package: BasebandSummary["package"];
  readonly members: BasebandSummary["members"];
  readonly containers: ReadonlyArray<Omit<BasebandSummary["containers"][number], "meta">>;
  readonly files: ReadonlyArray<Omit<SummaryFile, "text" | "hex"> & { readonly i: number; readonly readable: boolean }>;
  readonly nv: ReadonlyArray<Omit<BasebandSummary["nv"][number], "records"> & {
    readonly records: ReadonlyArray<Pick<NvRecord, "nv" | "efs" | "hex" | "name" | "meaning" | "label" | "confidence">>;
  }>;
  readonly images: BasebandSummary["images"];
  readonly bandCombos: BasebandSummary["bandCombos"];
  readonly amprNs: BasebandSummary["amprNs"];
  readonly mccs: MccCountries;
  readonly modemConfigs: NonNullable<BasebandSummary["modemConfigs"]> | null;
  readonly carrierMap: NonNullable<BasebandSummary["carrierMap"]> | null;
  readonly mdb: NonNullable<BasebandSummary["mdb"]> | null;
  readonly ssgccs: NonNullable<BasebandSummary["ssgccs"]> | null;
}

/** MCC to country code, by the bundles the manifest routes each PLMN to. */
async function mccCountries(mccs: Iterable<string>): Promise<MccCountries> {
  const votes = new Map<string, Map<string, number>>();
  for (const e of (await plmnTable()).entries) {
    const cc = e.bundle && splitName(e.bundle).cc;
    if (!cc || e.mcc === "901") continue; // 901 is international: satellite, roaming SIMs
    const m = votes.get(e.mcc) ?? new Map<string, number>();
    m.set(cc, (m.get(cc) ?? 0) + 1);
    votes.set(e.mcc, m);
  }
  const out: MccCountries = {};
  for (const mcc of mccs) {
    const best = [...(votes.get(mcc) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) out[mcc] = { cc: best, name: countryName(best) };
  }
  return out;
}

/** The page's view of a .bbfw package: everything but file contents and NV values. */
async function bbfwView(s: BasebandSummary): Promise<BbfwView> {
  const mccs = new Set([
    ...s.amprNs.flatMap((a) => a.groups.flatMap((g) => g.mccs)),
    ...(s.mdb?.databases ?? []).flatMap((d) => d.scan?.flatMap((e) => (e.mcc ? [e.mcc] : [])) ?? []),
  ]);
  return {
    kind: s.kind,
    package: s.package,
    members: s.members,
    // The header metadata is build-system placeholders apart from the version the page already names.
    containers: s.containers.map(({ meta: _meta, ...c }) => c),
    files: s.files.map(({ text, hex: _hex, ...f }, i) => ({ ...f, i, readable: text !== undefined })),
    nv: s.nv.map(({ records, ...n }) => ({
      ...n,
      records: records.map(({ nv, efs, hex, name, meaning, label, confidence }) => ({ nv, efs, hex, name, meaning, label, confidence })),
    })),
    images: s.images,
    bandCombos: s.bandCombos,
    amprNs: s.amprNs,
    // Country names are a nicety: the page is whole without them, so a manifest outage only drops them.
    mccs: await mccCountries(mccs).catch((): MccCountries => ({})),
    modemConfigs: s.modemConfigs ?? null,
    carrierMap: s.carrierMap ?? null,
    mdb: s.mdb ?? null,
    ssgccs: s.ssgccs ?? null,
  };
}

/** What a package page without a full view shows: the package header, and an ftab's entry table. */
export type PackageHeader = FtabSummary | { readonly kind: "bbfw"; readonly package: BasebandSummary["package"] };

export async function getModemPackageHeader(id: string): Promise<PackageHeader> {
  const s = await mustSummary(id);
  return s.kind === "ftab" ? s : { kind: s.kind, package: s.package };
}

export type BasebandPage = BbfwView & { readonly build: string; readonly version: string; readonly family: string; readonly id: string };

/** A release's .bbfw package of `family`. */
export async function getBaseband(build: string, family: string): Promise<BasebandPage> {
  const { version, m } = await releaseModem(build, family, "bbfw");
  const view = await bbfwView(await mustBbfw(m.package.id));
  return { build, version, family: m.family, id: m.package.id, ...view };
}

export type PackageFile = BasebandSummary["files"][number] & { readonly i: number };

export async function getBasebandFile(id: string, i: number): Promise<PackageFile> {
  const f = (await mustBbfw(id)).files[i];
  if (!f) error(404, `no file ${i} in modem package ${id}`);
  return { ...f, i };
}

/** One carrier's combo strings from one band_combos_per_plmn.xml variant. */
export async function getBasebandCombos(id: string, sha1: string, tag: string): Promise<string[]> {
  const f = (await mustBbfw(id)).files.find((x) => x.sha1 === sha1 && x.path.endsWith("/band_combos_per_plmn.xml"));
  if (!f?.text) error(404, `no band combo file ${sha1}`);
  const c = parseBandCombos(f.text).find((x) => x.tag === tag);
  if (!c) error(404, `no ${tag} in ${sha1}`);
  return c.combos;
}

export interface BasebandDiff {
  readonly family: string;
  readonly a: { readonly build: string; readonly version: string; readonly id: string };
  readonly b: { readonly build: string; readonly version: string; readonly id: string };
  readonly parts: BasebandDiffPart[];
  readonly counts: DiffCounts;
}

/** One family's package in build `b` against build `a`, part by part. A package pair is cached for a month. */
export async function getBasebandDiff(a: string, b: string, family: string): Promise<BasebandDiff> {
  const [A, B] = await Promise.all([releaseModem(a, family, "bbfw"), releaseModem(b, family, "bbfw")]);
  const diff = await cached(`bbdiff:v${MODEM_SUMMARY_SCHEMA}:${A.m.package.id}|${B.m.package.id}`, KEEP, async () => {
    const [ca, cb] = (await Promise.all([mustBbfw(A.m.package.id), mustBbfw(B.m.package.id)])).map(basebandComparable);
    const parts: BasebandDiffPart[] = Object.entries(cb ?? {}).flatMap(([section, after]) =>
      diffKeyed(ca?.[section] ?? {}, after, { maxRows: 300 }).map((p) => ({ section, ...p })));
    return { parts, counts: summariseDiff(parts) };
  });
  return {
    family,
    a: { build: a, version: A.version, id: A.m.package.id },
    b: { build: b, version: B.version, id: B.m.package.id },
    ...diff,
  };
}

/** A package summary for the bundle views (phones' modem defaults); null when not stored. */
export async function bbfwSummary(id: string): Promise<BasebandSummary | null> {
  const s = await modemSummary(id);
  return s?.kind === "bbfw" ? s : null;
}
