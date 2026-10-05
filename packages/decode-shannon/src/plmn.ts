/** PLMNs packed as TS 24.008 §10.5.1.13 bytes (MCC2 MCC1, MNC3 MCC3, MNC2 MNC1) in the low 3 bytes of an integer. */

import { ShannonFormatError } from "./wire.ts";

export interface Plmn {
  readonly mcc: string;
  /** null where both MNC digits are F: any MNC. */
  readonly mnc: string | null;
}

export function unpackPlmn(v: number): Plmn {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffff) throw new ShannonFormatError(`PLMN 0x${v.toString(16)}`);
  const nibble = (shift: number): number => (v >> shift) & 0xf;
  const [mcc1, mcc2, mcc3, mnc3, mnc1, mnc2] = [16, 20, 8, 12, 0, 4].map(nibble);
  const digits = (ds: readonly (number | undefined)[]): string => {
    if (ds.some((d) => d === undefined || d > 9)) throw new ShannonFormatError(`PLMN 0x${v.toString(16)}`);
    return ds.join("");
  };
  const mcc = digits([mcc1, mcc2, mcc3]);
  if (mnc1 === 0xf && mnc2 === 0xf && mnc3 === 0xf) return { mcc, mnc: null };
  return { mcc, mnc: digits(mnc3 === 0xf ? [mnc1, mnc2] : [mnc1, mnc2, mnc3]) };
}
