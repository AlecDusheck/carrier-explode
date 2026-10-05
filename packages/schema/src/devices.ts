/** Devices in the order pages list them: newest first, by the release the feeds record. */

import type { Device } from "./types.ts";

export type DeviceOrder = (a: string, b: string) => number;

/** Newest first; a launch's devices by code, highest first. A code no device record lists goes last. */
export function newestFirst(devices: readonly Device[]): DeviceOrder {
  const released = new Map(devices.map((d) => [d.code, d.released]));
  return (a, b) => {
    const x = released.get(a), y = released.get(b);
    if (x === undefined || y === undefined) return x === y ? a.localeCompare(b) : x === undefined ? 1 : -1;
    return y.localeCompare(x) || b.localeCompare(a, "en", { numeric: true });
  };
}

/** The newest of `codes`. */
export const newestOf = (order: DeviceOrder, codes: readonly string[]): string | undefined => codes.toSorted(order)[0];
