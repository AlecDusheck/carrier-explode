import { KINDS, type Kind } from "$lib/types";

export const match = (p: string): p is Kind => KINDS.some((k) => k === p);
