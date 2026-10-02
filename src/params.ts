import { defineParams } from "@sveltejs/kit/params";
import { KINDS, type Kind } from "#lib/types.ts";

export const params = defineParams({
  kind: (p): Kind | undefined => KINDS.find((k) => k === p),
});
