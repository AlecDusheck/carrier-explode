import type { Kind } from "$lib/server/data";

export const match = (p: string): p is Kind => p === "carriers" || p === "countries" || p === "watch";
