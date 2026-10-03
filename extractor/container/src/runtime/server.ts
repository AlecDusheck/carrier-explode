/**
 * The container's HTTP face, on 8080:
 *   POST /run   JobSpec → 202 at once; the job runs in the background and
 *               reports through control.internal /done. The same spec again
 *               → 202 (a retried Workflow step); a different one while busy → 409.
 *   GET  /health
 * A container runs one job in its life (its Durable Object is named by the job id).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { parseJobSpec, type AnyJobSpec } from "../../../src/jobs.ts";
import type { ControlClient } from "./control-client.ts";
import type { Deps } from "./context.ts";
import { executeJob, type Registry } from "./execute.ts";

const MAX_BODY = 1024 * 1024;

class BodyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if (!(chunk instanceof Buffer)) throw new BodyError(400, "unexpected body encoding");
    size += chunk.length;
    if (size > MAX_BODY) throw new BodyError(413, "body over 1 MiB");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    throw new BodyError(400, `body is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const reply = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
};

export interface Runtime {
  readonly server: Server;
  /** The job still running, if any: started and not yet reported. */
  running(): AnyJobSpec | undefined;
  /** Settles when the current job has reported /done (or failed to). */
  idle(): Promise<void>;
}

export function startRuntime(registry: Registry, deps: Deps & { readonly control: ControlClient }, port: number): Runtime {
  let current: { readonly spec: AnyJobSpec; readonly finished: Promise<void> } | undefined;
  let reported = false;

  const run = (spec: AnyJobSpec): Promise<void> =>
    executeJob(registry, spec, deps)
      .then((result) => {
        reported = true;
        return deps.control.done(result);
      })
      .catch((e: unknown) => {
        // /done could not be delivered after its retries: the Workflow's wait times out and retries the job.
        deps.log(`[${spec.id}] /done not delivered: ${e instanceof Error ? e.message : String(e)}`);
      });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url === "/health") return reply(res, 200, { ok: true, job: current?.spec.id ?? null });
    if (req.method !== "POST" || req.url !== "/run") return reply(res, 404, { error: `${req.method} ${req.url}: no such route` });
    let spec: AnyJobSpec;
    try {
      spec = parseJobSpec(await readBody(req));
    } catch (e) {
      return reply(res, e instanceof BodyError ? e.status : 400, { error: e instanceof Error ? e.message : String(e) });
    }
    if (current && current.spec.id !== spec.id) return reply(res, 409, { error: `busy with ${current.spec.id}` });
    if (!current) {
      deps.log(`[${spec.id}] start ${spec.type}`);
      current = { spec, finished: run(spec) };
    }
    return reply(res, 202, { id: spec.id });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => reply(res, 500, { error: e instanceof Error ? e.message : String(e) }));
  });
  server.listen(port);
  return {
    server,
    running: () => (current && !reported ? current.spec : undefined),
    idle: () => current?.finished ?? Promise.resolve(),
  };
}
