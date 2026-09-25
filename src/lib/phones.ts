/** Phones by the modem package that serves them, and the bundle files each one reads. */

import type { BundleFile } from "./decode/bundle";

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
  const named = phones.filter((p) => p.name).sort((a, b) => a.name!.localeCompare(b.name!, "en", { numeric: true }));
  return [...named, ...phones.filter((p) => !p.name).sort((a, b) => compareProducts(a.id, b.id))];
}

/** "iPhone 17, 17 Pro, 17 Pro Max": each name once, the shared "iPhone " said once. */
export function phoneList(phones: Phone[]): string {
  const names = [...new Set(sortPhones(phones).map((p) => p.name ?? p.id))];
  return names.map((n, i) => (i && n.startsWith("iPhone ") ? n.slice(7) : n)).join(", ");
}

/** The package serving `productType`. */
export const modemFor = <M extends PhoneModem>(modems: M[], productType?: string) =>
  productType ? modems.find((m) => m.devices.some((d) => d.id === productType)) : undefined;

const isPri = (f: Pick<BundleFile, "kind">) => f.kind === "pri-der" || f.kind === "pri-plain";

/** The bundle's modem override files for one phone, by the device codenames in their `overrides_<stem>` names. */
export const overridesFor = <F extends Pick<BundleFile, "kind" | "devices">>(files: F[], productType: string) =>
  files.filter((f) => isPri(f) && f.devices?.some((d) => d.ids === productType));

/** Modem files named for no phone: global_setting_*.der.gri, an MVNO set. */
export const sharedPri = <F extends Pick<BundleFile, "kind" | "devices">>(files: F[]) =>
  files.filter((f) => isPri(f) && !f.devices?.some((d) => d.ids));
