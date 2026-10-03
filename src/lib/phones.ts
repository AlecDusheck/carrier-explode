/** Phones by the modem package that serves them, and the bundle files each one reads. */

import type { BundleFile } from "./decode";

export interface Phone { id: string; name?: string }
export interface PhoneModem { family: string; devices: Phone[] }

/** "iPhone18,1" -> [18, 1]; newer models sort higher. */
const model = (id: string) => (/(\d+),(\d+)$/.exec(id) ?? [0, 0, 0]).slice(1).map(Number);

export function compareProducts(a: string, b: string): number {
  const [x, y] = [model(a), model(b)];
  return x[0] - y[0] || x[1] - y[1];
}

const newest = (m: PhoneModem) => m.devices.map((d) => d.id).sort(compareProducts).at(-1) ?? "";

/** Families serving the newest phone first. */
export const byNewest = <M extends PhoneModem>(modems: M[]) =>
  [...modems].sort((a, b) => compareProducts(newest(b), newest(a)));

/** Where a build's baseband pages open: the newest family serving a phone that has a name. Unreleased models ship early in images. */
export const defaultModem = <M extends PhoneModem>(modems: M[]) => {
  const sorted = byNewest(modems);
  return sorted.find((m) => m.devices.some((d) => d.name)) ?? sorted[0];
};

/** Named phones in name order, then unnamed ones by product type. */
export function sortPhones(phones: Phone[]): Phone[] {
  const named = phones
    .filter((p): p is Phone & { name: string } => !!p.name)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return [...named, ...phones.filter((p) => !p.name).sort((a, b) => compareProducts(a.id, b.id))];
}

/** "iPhone 17, 17 Pro, 17 Pro Max": each name once, the shared "iPhone " said once. */
export function phoneList(phones: Phone[]): string {
  const names = [...new Set(sortPhones(phones).map((p) => p.name ?? p.id))];
  return names.map((n, i) => (i && n.startsWith("iPhone ") ? n.slice(7) : n)).join(", ");
}

/**
 * The phone a bundle version means when none is named: a per-model OTA file's
 * (its product type is a model, "iPhone17,1", not a family like "iPad"), else
 * the one the image was cut for.
 */
export const homePhone = (entry: { productType?: string }, image: { product?: string }) =>
  entry.productType?.includes(",") ? entry.productType : image.product;

const isPri = (f: Pick<BundleFile, "kind">) => f.kind === "pri-der" || f.kind === "pri-plain";

/** The bundle's modem override files for one phone, by the device codenames in their `overrides_<stem>` names. */
export const overridesFor = <F extends Pick<BundleFile, "kind" | "devices">>(files: F[], productType: string) =>
  files.filter((f) => isPri(f) && f.devices?.some((d) => d.ids === productType));

/** Whether a copy was made once `productType` existed: an override file names it or a newer model. */
export const knowsPhone = <F extends Pick<BundleFile, "kind" | "devices">>(files: F[], productType: string) =>
  files.some((f) => isPri(f) && f.devices?.some((d) => d.ids && compareProducts(d.ids, productType) >= 0));

/** An override file's codes that name no phone the table knows: a board newer than the table. */
const unknownBoards = (f: Pick<BundleFile, "devices">) => (f.devices ?? []).filter((d) => d.name === undefined).map((d) => d.code);

/** Modem files named for no phone: global_setting_*.der.gri, an MVNO set. Not a board the table has yet to learn. */
export const sharedPri = <F extends Pick<BundleFile, "kind" | "devices">>(files: F[]) =>
  files.filter((f) => isPri(f) && !f.devices?.some((d) => d.ids) && !unknownBoards(f).length);

/** Modem files named only for boards the table does not know yet, each shown as its board code. */
export const unrecognisedPri = <F extends Pick<BundleFile, "kind" | "devices">>(files: F[]) =>
  files.filter((f) => isPri(f) && !f.devices?.some((d) => d.ids) && unknownBoards(f).length);

/** One phone group's modem override file, and the copy of the bundle it was read from when not this one. */
export interface PhoneRow {
  slug: string;
  path: string;
  /** Set when the file comes from another copy of the bundle (an OTA copy for an image's missing phones). */
  copy?: string;
  phones: Array<Phone & { family?: string }>;
  source?: "ota" | "image";
  ios?: string[];
  build?: string;
}

/** Files named for phones first, then the ones named for none (global_setting_*, MVNO sets). */
export function phoneRows(
  here: { slug: string; source?: "ota" | "image"; ios?: string[]; build?: string },
  files: Array<Pick<BundleFile, "kind" | "devices" | "path">>,
  ov: { files: Array<{ slug: string; path: string; phones: Array<Phone & { family?: string }> }> } | null,
): PhoneRow[] {
  // Newest phone first, whichever modem it uses.
  const newestIn = (f: { phones: Phone[] }) => f.phones.map((p) => p.id).sort(compareProducts).at(-1) ?? "";
  return [
    ...[...(ov?.files ?? [])].sort((x, y) => compareProducts(newestIn(y), newestIn(x)))
      .map((f) => ({ ...f, copy: f.slug === here.slug ? undefined : f.slug })),
    ...unrecognisedPri(files).map((f) => ({
      ...here, path: f.path, copy: undefined,
      phones: unknownBoards(f).map((code) => ({ id: code, name: `Unrecognised phone (${code})` })),
    })),
    ...sharedPri(files).map((f) => ({ ...here, path: f.path, copy: undefined, phones: [] })),
  ];
}

/**
 * The row a `?file=&copy=` selection names, else the newest phone's. `missing` says a named
 * file is not read by any phone in this version, so the page can say so instead of quietly
 * showing another phone.
 */
export function pickPhoneRow(rows: PhoneRow[], sel: { file: string | null; copy?: string }) {
  const named = sel.file ? rows.find((r) => r.path === sel.file && (r.copy === sel.copy || !sel.copy)) : undefined;
  return { row: named ?? rows[0], missing: !!sel.file && !named ? sel.file : undefined };
}
