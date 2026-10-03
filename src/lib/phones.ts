/** Phones by the modem package that serves them, and the iOS bundle files each one reads. */

import { byNewest, compareProducts, type BundleFile } from "#lib/decode/index.ts";

export interface Phone {
  readonly id: string;
  readonly name?: string | undefined;
}
export interface PhoneModem {
  readonly family: string;
  readonly devices: readonly Phone[];
}

/** Where a build's baseband pages open: the newest family serving a phone that has a name. Unreleased models ship early in images. */
export function defaultModem<M extends PhoneModem>(modems: readonly M[]): M | undefined {
  const sorted = byNewest(modems);
  return sorted.find((m) => m.devices.some((d) => d.name)) ?? sorted[0];
}

/** Named phones in name order, then unnamed ones by product type. */
export function sortPhones<P extends Phone>(phones: readonly P[]): P[] {
  const named = phones.filter((p) => p.name).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "en", { numeric: true }));
  return [...named, ...phones.filter((p) => !p.name).sort((a, b) => compareProducts(a.id, b.id))];
}

/** "iPhone 17, 17 Pro, 17 Pro Max": each name once, the shared "iPhone " said once. */
export function phoneList(phones: readonly Phone[]): string {
  const names = [...new Set(sortPhones(phones).map((p) => p.name ?? p.id))];
  return names.map((n, i) => (i && n.startsWith("iPhone ") ? n.slice(7) : n)).join(", ");
}

/** The phone a bundle version means when none is named: the newest phone of the release it is read against. */
export function homePhone(devices: readonly string[]): string | undefined {
  return [...devices].sort(compareProducts).at(-1);
}

/** The newest named model among phones: the one a group of them is pictured by. */
export const newestNamed = (phones: readonly Phone[]): string | undefined =>
  phones.filter((p) => p.name).sort((a, b) => compareProducts(b.id, a.id))[0]?.name;

type FileRef = Pick<BundleFile, "kind" | "devices">;

/** A bundle file that is a modem override (.der.pri or plain .pri). */
export const isPri = (f: Pick<BundleFile, "kind">): boolean => f.kind === "pri-der" || f.kind === "pri-plain";

/** The bundle's modem override files for one phone, by the device codenames in their `overrides_<stem>` names. */
export const overridesFor = <F extends FileRef>(files: readonly F[], productType: string): F[] =>
  files.filter((f) => isPri(f) && f.devices?.some((d) => d.ids === productType));

/** Whether a copy was made once `productType` existed: an override file names it or a newer model. */
export const knowsPhone = (files: readonly FileRef[], productType: string): boolean =>
  files.some((f) => isPri(f) && f.devices?.some((d) => d.ids !== undefined && compareProducts(d.ids, productType) >= 0));

/** An override file's codes that name no phone the table knows: a board newer than the table. */
const unknownBoards = (f: Pick<BundleFile, "devices">): string[] =>
  (f.devices ?? []).filter((d) => d.name === undefined).map((d) => d.code);

const namesNoPhone = (f: FileRef): boolean => isPri(f) && !f.devices?.some((d) => d.ids);

/** Modem files named for no phone: global_setting_*.der.gri, an MVNO set. Not a board the table has yet to learn. */
export const sharedPri = <F extends FileRef>(files: readonly F[]): F[] =>
  files.filter((f) => namesNoPhone(f) && !unknownBoards(f).length);

/** Modem files named only for boards the table does not know yet, each shown as its board code. */
export const unrecognisedPri = <F extends FileRef>(files: readonly F[]): F[] =>
  files.filter((f) => namesNoPhone(f) && unknownBoards(f).length > 0);

export type GroupPhone = Phone & { readonly family?: string | undefined };

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
  files: ReadonlyArray<Pick<BundleFile, "kind" | "devices" | "path">>,
  ov: { readonly files: readonly PhoneRow[] } | null,
): PhoneRow[] {
  const newestIn = (f: PhoneRow): string => f.phones.map((p) => p.id).sort(compareProducts).at(-1) ?? "";
  return [
    ...[...(ov?.files ?? [])].sort((x, y) => compareProducts(newestIn(y), newestIn(x))),
    ...unrecognisedPri(files).map((f) => ({
      slug, path: f.path, phones: unknownBoards(f).map((code) => ({ id: code, name: `Unrecognised phone (${code})` })),
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
