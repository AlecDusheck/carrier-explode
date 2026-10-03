import { RequestError } from "../protocol/errors.ts";
import type { Env } from "./env.ts";

/** Throws 401 unless the request carries `Authorization: Bearer <RUN_TOKEN>`; compared in constant time. */
export function authorize(req: Request, env: Env): void {
  const given = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!env.RUN_TOKEN || given === undefined) throw new RequestError(401, "bearer token required");
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(env.RUN_TOKEN);
  if (a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) throw new RequestError(401, "bad token");
}
