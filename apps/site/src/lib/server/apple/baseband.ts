/** iOS modem packages: each release's packages (Release.modems), their summaries, and what a bundle's phones run from them, as the builds pages and the Modem tab read them. */

import { error } from "@sveltejs/kit";
import {
  MODEM_SUMMARY_SCHEMA, basebandComparable, byNewest, carriedBy, diffKeyed, mergeComboSets, newestProduct, priReplacements, priText,
  type BasebandSummary, type ComboSetRow, type FileDiff, type FtabSummary, type ModemSummary, type PriReplacement,
} from "@carrier-explode/decode-ios";
import { parseBandCombos } from "@carrier-explode/decode-qualcomm";
import { diffValues, summariseDiff, type DiffCounts, type DiffRow } from "@carrier-explode/values";
import { overridesFor, sharedPri } from "#lib/apple/phones.ts";
import { cached, perRequest } from "../cache";
import type { Ver } from "#lib/types.ts";
import { open, readPri } from "./bytes";
import { phoneCopies } from "./phones";
import * as records from "./modem-records";
import { modemViews, summaryKey, type ModemView } from "./modems";
import { namer } from "../names";
import { releaseModems, shippedVersion } from "../releases";
import { readJson } from "../store";
import { countryName, isoForMcc } from "@carrier-explode/schema";
import { sourceKey, type ImageModem, type ModemKind, type Named } from "@carrier-explode/schema/types";

const modemSummary = perRequest((id: string): Promise<ModemSummary | null> => readJson(summaryKey(id), records.modemSummary));

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
  /** The page of the Default bundle this build ships, which holds the regional band tables; null when not indexed. */
  readonly defaultBundle: string | null;
}

const DEFAULT_BUNDLE = sourceKey({ platform: "ios", kind: "carrier", name: "Default" });

/** A build's modem packages, one per distinct package, with the phones each serves; newest phones first. */
export async function getModemPackages(build: string): Promise<BuildModems> {
  const { release, modems } = await releaseModems(build);
  const defaults = await shippedVersion(build, DEFAULT_BUNDLE);
  return { build, version: release.version, modems: byNewest(await modemViews(modems)), defaultBundle: defaults?.path ?? null };
}

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

function mccCountries(mccs: Iterable<string>): MccCountries {
  const out: MccCountries = {};
  for (const mcc of mccs) {
    const cc = isoForMcc(mcc);
    if (cc) out[mcc] = { cc, name: countryName(cc) };
  }
  return out;
}

/** The page's view of a .bbfw package: everything but file contents and NV values. */
function bbfwView(s: BasebandSummary): BbfwView {
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
      // The raw f11/f14/f77/f78 fields are not shown.
      records: records.map(({ f11: _f11, f14: _f14, f77: _f77, f78: _f78, ...shown }) => shown),
    })),
    images: s.images,
    bandCombos: s.bandCombos,
    amprNs: s.amprNs,
    mccs: mccCountries(mccs),
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
  const view = bbfwView(await mustBbfw(m.package.sha));
  return { build, version, family: m.family, id: m.package.sha, ...view };
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

/** One part of a modem package diff, under the section it belongs to. */
export interface BasebandDiffPart extends FileDiff {
  readonly section: string;
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
  const diff = await cached(`bbdiff:v${MODEM_SUMMARY_SCHEMA}:${A.m.package.sha}|${B.m.package.sha}`, async () => {
    const [ca, cb] = (await Promise.all([mustBbfw(A.m.package.sha), mustBbfw(B.m.package.sha)])).map(basebandComparable);
    const parts: BasebandDiffPart[] = Object.entries(cb ?? {}).flatMap(([section, after]) =>
      diffKeyed(ca?.[section] ?? {}, after, { maxRows: 300 }).map((p) => ({ section, ...p })));
    return { parts, counts: summariseDiff(parts) };
  });
  return {
    family,
    a: { build: a, version: A.version, id: A.m.package.sha },
    b: { build: b, version: B.version, id: B.m.package.sha },
    ...diff,
  };
}

/** A package summary for the bundle views (phones' modem defaults); null when not stored. */
export async function bbfwSummary(id: string): Promise<BasebandSummary | null> {
  const s = await modemSummary(id);
  return s?.kind === "bbfw" ? s : null;
}

export interface ComboTag {
  readonly tag: string;
  readonly plmns: readonly string[];
  readonly primary: boolean;
  readonly sets: readonly ComboSetRow[];
}

export type ModemDefaults =
  | { readonly missing: true; readonly build: string | null }
  | {
    readonly missing: false;
    readonly build: string;
    readonly version: string;
    readonly family: Named;
    readonly id: string;
    readonly phone: string;
    readonly tags: readonly ComboTag[];
    readonly overrides: ReadonlyArray<{ readonly pri: string } & PriReplacement>;
    readonly otherXml: number;
    /** The version the .der.pri files were read from, for getBasebandOverride. */
    readonly slug: string;
  };

/**
 * What the modem of `device` runs for this bundle before the bundle's own
 * .der.pri lands: the band-combo carrier tags whose PLMNs route here, and the
 * package files that phone's .der.pri replaces by EFS path. Without `device`,
 * the version's home phone.
 */
export async function getBasebandDefaults(at: Ver, device?: string): Promise<ModemDefaults> {
  const v = await phoneCopies(at);
  if (!v) return { missing: true, build: null };
  // Without a phone named, the newest one the release is read against.
  const phone = device ?? newestProduct(at.line ? [at.line] : v.devices);
  const m = phone ? v.modems.find((x) => x.devices.includes(phone) && x.package.kind === "bbfw") : undefined;
  const [{ opened, files, ref }, s] = await Promise.all([open(at), m ? bbfwSummary(m.package.sha) : null]);
  if (!phone || !m || !s) return { missing: true, build: v.build };

  const name = ref.name;
  const tags = Object.entries(s.carrierMap ?? {})
    .filter(([, c]) => c.bundles.includes(name) || c.mvnoBundles.includes(name))
    .map(([tag, c]): ComboTag => ({ tag, plmns: c.plmns, primary: c.bundles.includes(name), sets: mergeComboSets(s.bandCombos, tag) }));

  const own = new Set([...overridesFor(files, phone), ...sharedPri(files)].map((f) => f.path));
  const overrides: Array<{ pri: string } & PriReplacement> = [];
  let otherXml = 0;
  for (const file of opened.info.files) {
    const pri = file.kind === "pri-der" && own.has(file.path) ? readPri(opened, file.path) : undefined;
    if (!pri) continue;
    const r = priReplacements(pri, s);
    overrides.push(...r.replaced.map((x) => ({ pri: file.path, ...x })));
    otherXml += r.otherXml;
  }
  const [{ release }, family] = await Promise.all([releaseModems(v.build), namer("modem", [m.family])]);
  return {
    missing: false, build: v.build, version: release.version, family: family(m.family), id: m.package.sha, phone, tags, overrides, otherXml,
    slug: v.entry.slug,
  };
}

export interface ModemOverride {
  readonly id: string;
  readonly efs: string;
  readonly pri: string;
  readonly where: string;
  readonly member: string;
  readonly baseline: string;
  readonly override: string;
  readonly rows: readonly DiffRow[];
  readonly counts: DiffCounts;
}

/** File `i` of modem package `id` next to the .der.pri value that replaces it, with the lines that differ. */
export async function getBasebandOverride(v: Ver, id: string, pri: string, efs: string, i: number): Promise<ModemOverride> {
  const [{ opened }, s] = await Promise.all([open(v), bbfwSummary(id)]);
  const base = s?.files[i];
  if (!base?.text || base.path !== efs) error(404, `no package file ${i} at ${efs}`);
  const value = readPri(opened, pri)?.efs.find((e) => e.path === efs)?.value;
  const text = value && priText(value);
  if (text === undefined) error(404, `${pri} does not set ${efs}`);
  const rows = diffValues(base.text.split("\n"), text.split("\n"));
  return { id, efs, pri, where: carriedBy(base), member: base.member, baseline: base.text, override: text, rows, counts: summariseDiff(rows) };
}
