/** `20261003T051700`, UTC: run ids, scan generations, dev job ids. */
export const stamp = (t: Date): string => t.toISOString().replace(/[-:]/g, "").slice(0, 15);
