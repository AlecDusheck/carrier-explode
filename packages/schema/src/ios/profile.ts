/** Apple bundle -> Profile: the newest phone's settings (carrier.plist plus its override file); other phones and MVNOs are variants. */

import { canonical } from "@carrier-explode/values";
import { compareProducts, decodeFile, decodedPlist, flattenBundle, isJsonDict, newestProduct, type BundleFile, type OpenedBundle } from "@carrier-explode/decode-ios";
import { toJson } from "../json.ts";
import { uniqueSims } from "../sims.ts";
import { PROFILE_SCHEMA, type Apn, type ConceptValue, type Json, type Profile, type ProfileVariant, type SourceRef } from "../types.ts";
import { readingKey, text } from "../values.ts";
import { iosApns } from "./apns.ts";
import { productOf, type BoardProducts } from "./boards.ts";
import { iosIso, supportedSims } from "./identity.ts";
import { iosConcepts } from "./readers.ts";
import { mvnoConfigurations, settings, withLayer, type Layer, type Settings } from "./settings.ts";

/** A member as a dictionary; a broken or absent one contributes nothing, as on the phone. */
function plistDict(b: OpenedBundle, path: string): Readonly<Record<string, unknown>> | undefined {
  if (!b.info.files.some((f) => f.path === path)) return undefined;
  const v = decodedPlist(decodeFile(b, path));
  return isJsonDict(v) ? v : undefined;
}

/** Product types (`iPhone18,1`) an override file names; board codes for boards no device record lists yet. */
const devicesOf = (f: BundleFile, products: BoardProducts): string[] => (f.boards ?? []).map((b) => productOf(products, b) ?? b);

/** The newest product type a file names; "" when it names none the device records list. */
const newestIn = (f: BundleFile, products: BoardProducts): string => newestProduct((f.boards ?? []).flatMap((b) => productOf(products, b) ?? [])) ?? "";

interface PhoneFile {
  readonly file: BundleFile;
  readonly layer: Layer;
}

/** `overrides_<boards>.plist` files, newest phone first. */
function phoneFiles(b: OpenedBundle, products: BoardProducts): PhoneFile[] {
  return b.info.files
    .filter((f) => /^overrides_.+\.plist$/.test(f.path))
    .flatMap((file) => {
      const dict = plistDict(b, file.path);
      return dict === undefined ? [] : [{ file, layer: { file: file.path, prefix: "", dict } }];
    })
    .sort((x, y) => compareProducts(newestIn(y.file, products), newestIn(x.file, products)) || x.file.path.localeCompare(y.file.path));
}

interface Mapped {
  readonly concepts: Readonly<Record<string, ConceptValue>>;
  readonly apns: readonly Apn[];
}

function mapSettings(s: Settings, kind: SourceRef["kind"]): Mapped {
  const apns = iosApns(s);
  const all = iosConcepts({ settings: s, apns });
  // Country bundles carry place settings only; carrier features would read "no" throughout.
  const concepts = kind === "country" ? Object.fromEntries(Object.entries(all).filter(([, v]) => v.kind === "value")) : all;
  return { concepts, apns };
}

const apnText = (apns: readonly Apn[]): string => canonical(apns.map((a) => toJson({ ...a, path: "" }) ?? null));

/**
 * The name the bundle shows in the status bar: StatusBarImages maps each name a network broadcasts to one shown, and
 * the one most entries show is the carrier's (TIM_br shows TIM for three and VIVO for one).
 */
function statusBarName(merged: Readonly<Record<string, unknown>>): { readonly display?: string } {
  const images = merged["StatusBarImages"];
  const shown = (Array.isArray(images) ? images : []).flatMap((image: unknown) => {
    const name = isJsonDict(image) ? text(image["StatusBarCarrierName"]) : undefined;
    return name === undefined ? [] : [name];
  });
  const counts = Map.groupBy(shown, (name) => name);
  // Ties go to the earlier entry: Map keeps first-seen order and the sort is stable.
  const [top] = [...counts].sort(([, x], [, y]) => y.length - x.length);
  return top === undefined ? {} : { display: top[0] };
}

/** The concepts and APNs `other` changes; undefined when it changes none. */
function variant(id: string, when: ProfileVariant["when"], main: Mapped, other: Mapped): ProfileVariant | undefined {
  const concepts = Object.fromEntries(Object.entries(other.concepts).filter(([cid, v]) => {
    const m = main.concepts[cid];
    return m === undefined || readingKey(m) !== readingKey(v);
  }));
  if (Object.keys(concepts).length === 0 && apnText(main.apns) === apnText(other.apns)) return undefined;
  return { id, when, concepts, apns: other.apns };
}

/** Credentials are never republished: APN passwords, and CDMA's SIP and AN passwords and Mobile IP shared secrets. */
const isSecret = (path: string): boolean => /(password|secret)(\[\d+\])*$/i.test(path);

/** Every leaf of every decodable member but secrets, keyed `<file>:<path>`. */
function rawOf(b: OpenedBundle): Record<string, Json> {
  return Object.fromEntries(Object.entries(flattenBundle(b)).flatMap(([file, flat]) =>
    Object.entries(flat).flatMap(([path, v]): Array<[string, Json]> => (isSecret(path) ? [] : [[`${file}:${path}`, toJson(v) ?? null]]))));
}

/** A phone's variant, by its override plist (`overrides_D83_D84.plist`). */
export const phoneVariantId = (plist: string): string => `phones:${plist}`;

export function iosProfile(bundle: OpenedBundle, source: SourceRef, sha: string, products: BoardProducts): Profile {
  const carrier = settings([{ file: "carrier.plist", prefix: "", dict: plistDict(bundle, "carrier.plist") ?? {} }]);
  const [home, ...others] = phoneFiles(bundle, products);
  const main = home === undefined ? carrier : withLayer(carrier, home.layer);
  const mapped = mapSettings(main, source.kind);
  const mvnos = mvnoConfigurations(main);
  const sims = uniqueSims([...supportedSims(main.merged.SupportedSIMs), ...mvnos.flatMap((m) => supportedSims(m.supportedSims))]);
  const phones = others.flatMap((p) =>
    variant(phoneVariantId(p.file.path), { kind: "device", devices: devicesOf(p.file, products) }, mapped, mapSettings(withLayer(carrier, p.layer), source.kind)) ?? []);
  const carriers = mvnos.flatMap((m) =>
    variant(`mvno:${m.name}`, { kind: "sim", sims: supportedSims(m.supportedSims) }, mapped, mapSettings(m.settings, source.kind)) ?? []);
  return {
    schema: PROFILE_SCHEMA,
    source,
    sha,
    identity: { ...statusBarName(main.merged), iso: iosIso(source, main.merged, sims), sims },
    apns: mapped.apns,
    concepts: mapped.concepts,
    raw: rawOf(bundle),
    variants: [...phones, ...carriers],
  };
}
