/** Phones by the modem package that serves them, and the iOS bundle files each one reads. */

import { compareProducts, newestProduct, type BundleFile } from "@carrier-explode/decode-ios";
import type { BoardRef } from "@carrier-explode/schema";
import type { Named } from "@carrier-explode/schema/types";

/** A board a file's name gives, with its phone's name, or the board's own where no device record lists it. */
export type NamedBoard = BoardRef & { readonly name: string };

/** A bundle file or member with the phones its name's boards are. */
export type WithPhones<F> = F & { readonly devices?: readonly NamedBoard[] };

/** A bundle file, an override file with the phones its name's boards are. */
export type PhoneFile = WithPhones<BundleFile>;

/** Nothing names a phone that reads as its code. */
const isNamed = (p: Named): boolean => p.name !== p.code;

/** Named phones in name order, then unnamed ones by product type. */
export function sortPhones<P extends Named>(phones: readonly P[]): P[] {
  const named = phones.filter(isNamed).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return [...named, ...phones.filter((p) => !isNamed(p)).sort((a, b) => compareProducts(a.code, b.code))];
}

/** "iPhone 17, 17 Pro, 17 Pro Max": each name once, the shared "iPhone " said once. */
export function phoneList(phones: readonly Named[]): string {
  const names = [...new Set(sortPhones(phones).map((p) => p.name))];
  return names.map((n, i) => (i && n.startsWith("iPhone ") ? n.slice(7) : n)).join(", ");
}

/** The newest named model among phones: the one a group of them is pictured by. */
export const newestNamed = (phones: readonly Named[]): string | undefined =>
  phones.filter(isNamed).sort((a, b) => compareProducts(b.code, a.code))[0]?.name;

type FileRef = Pick<PhoneFile, "kind" | "devices">;

/** A bundle file that is a modem override (.der.pri, plain .pri or .der.tri). */
export const isPri = (f: Pick<BundleFile, "kind">): boolean => f.kind === "pri-der" || f.kind === "pri-plain" || f.kind === "tri-der";

/** The bundle's modem override files for one phone, by the boards in their `overrides_<stem>` names. */
export const overridesFor = <F extends FileRef>(files: readonly F[], productType: string): F[] =>
  files.filter((f) => isPri(f) && f.devices?.some((d) => d.product === productType));

/** Whether a copy was made once `productType` existed: an override file names it or a newer model. */
export const knowsPhone = (files: readonly FileRef[], productType: string): boolean =>
  files.some((f) => isPri(f) && f.devices?.some((d) => d.product !== undefined && compareProducts(d.product, productType) >= 0));

/** An override file's boards that name no phone the device records list: a board newer than the records. */
const unknownBoards = (f: Pick<PhoneFile, "devices">): string[] =>
  (f.devices ?? []).filter((d) => d.product === undefined).map((d) => d.board);

const namesNoPhone = (f: FileRef): boolean => isPri(f) && !f.devices?.some((d) => d.product);

/** Modem files named for no phone: global_setting_*.der.gri, an MVNO set. Not a board the records have yet to list. */
export const sharedPri = <F extends FileRef>(files: readonly F[]): F[] =>
  files.filter((f) => namesNoPhone(f) && !unknownBoards(f).length);

/** Modem files named only for boards the device records do not list yet, each shown as its board code. */
export const unrecognisedPri = <F extends FileRef>(files: readonly F[]): F[] =>
  files.filter((f) => namesNoPhone(f) && unknownBoards(f).length > 0);

/** A phone with the modem generation it runs, where the release says. */
export type GroupPhone = Named & { readonly family?: Named };

/** One phone group's modem override file in a bundle version. */
export interface PhoneRow {
  /** The version the file is read from. */
  readonly slug: string;
  readonly path: string;
  readonly phones: readonly GroupPhone[];
}

/** Files named for phones first, newest phone first whichever modem it uses, then the ones named for none (global_setting_*, MVNO sets). */
export function phoneRows(
  slug: string,
  files: ReadonlyArray<Pick<PhoneFile, "kind" | "devices" | "path">>,
  ov: { readonly files: readonly PhoneRow[] } | null,
): PhoneRow[] {
  const newestIn = (f: PhoneRow): string => newestProduct(f.phones.map((p) => p.code)) ?? "";
  return [
    ...[...(ov?.files ?? [])].sort((x, y) => compareProducts(newestIn(y), newestIn(x))),
    ...unrecognisedPri(files).map((f) => ({
      slug, path: f.path, phones: unknownBoards(f).map((code) => ({ code, name: `Unrecognised phone (${code})` })),
    })),
    ...sharedPri(files).map((f) => ({ slug, path: f.path, phones: [] })),
  ];
}

/**
 * The row a `?file=` selection names, else the newest phone's. `missing` says a named
 * file is not read by any phone in this version, so the page can say so instead of quietly
 * showing another phone.
 */
export function pickPhoneRow(rows: readonly PhoneRow[], file: string | null): { row: PhoneRow | undefined; missing: string | undefined } {
  const named = file ? rows.find((r) => r.path === file) : undefined;
  return { row: named ?? rows[0], missing: file && !named ? file : undefined };
}

/** One phone picker choice: the phones it covers, pictured by the newest. */
export interface PhoneChoice {
  readonly key: string;
  readonly label: string;
  readonly id: string | undefined;
  readonly name: string | undefined;
  readonly href: string;
}

/** An Apple version's override-file rows as phone picker choices; picking one sets `?file=`. */
export function fileChoices(rows: readonly PhoneRow[], href: (path: string) => string): PhoneChoice[] {
  return rows.map((r) => {
    const modems = [...new Set(r.phones.flatMap((p) => p.family?.name ?? []))].join(", ");
    const newest = [...r.phones].sort((a, b) => compareProducts(b.code, a.code))[0];
    return {
      key: r.path,
      label: r.phones.length ? `${phoneList(r.phones)}${modems ? ` · ${modems}` : ""}` : `${r.path} (not named for a phone)`,
      id: newest?.code,
      name: newestNamed(r.phones),
      href: href(r.path),
    };
  });
}
