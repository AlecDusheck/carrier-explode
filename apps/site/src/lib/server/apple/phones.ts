/** Which phones read which of an Apple bundle's modem override files, and how each phone's files changed between versions. */

import { byNewest, comparable, decodeFile, isJsonDict, newestProduct, type BundleFile } from "@carrier-explode/decode-ios";
import { diffValues, summariseDiff, type DiffCounts, type DiffRow } from "@carrier-explode/values";
import type { ImageModem, Named, Platform, TimelineEntry } from "@carrier-explode/schema/types";
import { isPri, knowsPhone, overridesFor, type GroupPhone, type PhoneFile, type PhoneRow } from "#lib/apple/phones.ts";
import { cached, perRequest } from "../cache";
import { PHONE_IMAGES, currentRelease, releaseList, resolve, verFrom } from "../catalog";
import type { Ver } from "#lib/types.ts";
import { open, plistOf, type Opened } from "./bytes";
import { modemViews } from "./modems";
import { releaseModems } from "../releases";

type FileRef = Pick<PhoneFile, "path" | "kind" | "devices">;
export type ReleasePhone = GroupPhone & { readonly family: Named };

/** The release a version is read against: the newest image carrying it, else (an OTA file) the current release. */
async function releaseOf(platform: Platform, entry: TimelineEntry): Promise<string | null> {
  const images = PHONE_IMAGES[platform];
  // Only iPhone images carry modem packages.
  if (images !== "ios") return null;
  const carrying = new Set(entry.copies.flatMap((c) => (c.kind === "image" ? c.releases : [])));
  const newest = (await releaseList()).find((r) => r.platform === images && carrying.has(r.id));
  return newest?.id ?? (await currentRelease(images))?.id ?? null;
}

interface PhoneCopies {
  readonly entry: TimelineEntry;
  readonly build: string;
  readonly devices: readonly string[];
  readonly modems: readonly ImageModem[];
  readonly phones: readonly ReleasePhone[];
  readonly copies: ReadonlyArray<{ readonly files: readonly FileRef[]; readonly known: boolean }>;
}

/**
 * Every phone of a version's release, newest family first, with its modem override files in that
 * version. A phone without any is `known` when the version was made while it existed (so it has none
 * and runs the defaults); otherwise the version is older than the phone.
 */
const phoneCopiesOnce = perRequest(async (source: string, line: string, slug: string): Promise<PhoneCopies | null> => {
  const { entry, files, ref } = await open(verFrom(source, line, slug));
  const build = await releaseOf(ref.platform, entry);
  if (!build) return null;
  const { release, modems } = await releaseModems(build);
  const phones = byNewest(await modemViews(modems)).flatMap((m) => m.devices.map((d) => ({ ...d, family: m.family })));
  const copies = phones.map((p) => {
    const mine = overridesFor(files, p.code).map(({ path, kind, devices }): FileRef => ({ path, kind, ...(devices ? { devices } : {}) }));
    return { files: mine, known: mine.length > 0 || knowsPhone(files, p.code) };
  });
  return { entry, build, devices: release.devices, modems, phones, copies };
});
export const phoneCopies = (v: Ver): Promise<PhoneCopies | null> => phoneCopiesOnce(v.source, v.line ?? "", v.slug ?? "");

export interface BundleOverrides {
  readonly build: string;
  /** The phone the version means. */
  readonly home: string | undefined;
  readonly files: readonly PhoneRow[];
  /** Phones with no override file in a version made while they existed: they run the modem's defaults. */
  readonly defaults: readonly ReleasePhone[];
  /** Phones newer than the version. */
  readonly unknown: readonly ReleasePhone[];
}

/** A version's modem override files, each with the phones that read it, and the phones left over. */
export async function getBundleOverrides(at: Ver): Promise<BundleOverrides | null> {
  const v = await phoneCopies(at);
  if (!v) return null;
  const files = new Map<string, { slug: string; path: string; phones: ReleasePhone[] }>();
  const defaults: ReleasePhone[] = [], unknown: ReleasePhone[] = [];
  v.phones.forEach((p, i) => {
    const c = v.copies[i];
    if (!c?.files.length) {
      (c?.known ? defaults : unknown).push(p);
      return;
    }
    for (const f of c.files) {
      const row = files.get(f.path) ?? { slug: v.entry.slug, path: f.path, phones: [] };
      row.phones.push(p);
      files.set(f.path, row);
    }
  });
  return { build: v.build, home: newestProduct(at.line ? [at.line] : v.devices), files: [...files.values()], defaults, unknown };
}

/** An override file present in both versions, diffed. */
export interface ComparedFile {
  readonly kind: "same" | "changed";
  readonly path: string;
  readonly before: string;
  readonly counts: DiffCounts;
  readonly rows: readonly DiffRow[];
  readonly truncated: boolean;
}

/** One override file of a phone group, against what that phone had before. */
export type PhoneFileChange = { readonly kind: "added"; readonly path: string } | { readonly kind: "removed"; readonly before: string } | ComparedFile;

export interface PhoneChange {
  readonly phones: readonly ReleasePhone[];
  /**
   * "compared": the version compared against has files for these phones. "new": it was made while the phone
   * existed and gave it none (carrier.plist alone). "unknown": it is older than the phone.
   */
  readonly status: "compared" | "new" | "unknown";
  readonly plist: PhoneFileChange | null;
  readonly modem: PhoneFileChange | null;
}

type CachedChange = Omit<PhoneChange, "phones"> & { readonly phones: readonly string[] };

const PHONE_ROWS = 300;
const isPhonePlist = (f: Pick<BundleFile, "path">): boolean => /^overrides_.+\.plist$/.test(f.path);

function fileChange(A: Opened | null, before: string | undefined, B: Opened, path: string | undefined): PhoneFileChange | null {
  const value = ({ opened: o }: Opened, p: string): unknown => {
    try {
      return comparable(decodeFile(o, p));
    } catch {
      // A member that does not decode compares as absent; Files shows why.
      return null;
    }
  };
  if (!path) return before ? { kind: "removed", before } : null;
  if (!A || !before) return { kind: "added", path };
  const rows = diffValues(value(A, before), value(B, path), isJsonDict);
  return { kind: rows.length ? "changed" : "same", path, before, counts: summariseDiff(rows), rows: rows.slice(0, PHONE_ROWS), truncated: rows.length > PHONE_ROWS };
}

/**
 * A version's phone groups, each one's override plist and modem file against what that phone had at the
 * version compared against. Comparing the two copies file by file would show a phone moving to another
 * group's file as one file removed and another added; this compares per phone.
 */
export async function getPhoneChanges(v: Ver, against?: string): Promise<PhoneChange[] | null> {
  const { entry: b, previous } = await resolve(v);
  const a = against ? (await resolve({ ...v, slug: against })).entry : previous;
  const vb = await phoneCopies(v);
  if (!a || !vb) return null;
  // Cached by phone code: the names are the index's, which a publish can change under the same bundles.
  const changes = await cached(`phonechanges:v5:${b.sha}|${a.sha}|${vb.phones.map((p) => p.code).join(",")}`, async () => {
    const [A, B] = await Promise.all([open({ ...v, slug: a.slug }), open(v)]);
    /** A phone's override files in a copy: its plist and its modem file, by the boards in their names. */
    const filesFor = (o: Opened, phone: string): PhoneFile[] => o.files.filter((f) => f.devices?.some((d) => d.product === phone));
    // Phone groups as this version files them: phones that read the same files.
    const groups = new Map<string, { files: PhoneFile[]; phones: string[] }>();
    for (const p of vb.phones) {
      const files = filesFor(B, p.code);
      if (!files.length) continue;
      const k = files.map((f) => f.path).sort().join("|");
      const g = groups.get(k) ?? { files, phones: [] };
      g.phones.push(p.code);
      groups.set(k, g);
    }
    return [...groups.values()].flatMap(({ files, phones }): CachedChange[] => {
      const phone = phones[0];
      if (!phone) return [];
      const before = filesFor(A, phone);
      const known = before.length > 0 || knowsPhone(A.files, phone);
      const had = before.length ? A : null;
      return [{
        phones,
        status: before.length ? "compared" : known ? "new" : "unknown",
        plist: fileChange(had, before.find(isPhonePlist)?.path, B, files.find(isPhonePlist)?.path),
        modem: fileChange(had, before.find(isPri)?.path, B, files.find(isPri)?.path),
      }];
    });
  });
  const phoneOf = new Map(vb.phones.map((p) => [p.code, p]));
  return changes.map((c) => ({ ...c, phones: c.phones.flatMap((code) => phoneOf.get(code) ?? []) }));
}

export interface OverridePlist {
  readonly path: string;
  readonly plist: Readonly<Record<string, unknown>>;
}

/** A phone's override plist, beside its modem override file. */
export const overridePlistOf = (priPath: string): string => priPath.replace(/(\.der)?\.pri$/, ".plist");

/** A phone's override plist next to its modem file (same stem), decoded; null when the copy has none. */
export async function getOverridePlist(v: Ver, priPath: string): Promise<OverridePlist | null> {
  const path = overridePlistOf(priPath);
  const plist = plistOf((await open(v)).opened, path);
  return plist ? { path, plist } : null;
}
