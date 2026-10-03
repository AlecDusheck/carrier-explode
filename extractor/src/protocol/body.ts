import * as v from "valibot";

import { RequestError } from "./errors.ts";

/** A JSON request body validated against `schema`; 400 with valibot's summary otherwise. */
export async function readJson<S extends v.GenericSchema>(req: Request, schema: S): Promise<v.InferOutput<S>> {
  const raw: unknown = await req.json().catch((e: unknown) => {
    throw new RequestError(400, `body is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  });
  const parsed = v.safeParse(schema, raw);
  if (!parsed.success) throw new RequestError(400, v.summarize(parsed.issues));
  return parsed.output;
}
