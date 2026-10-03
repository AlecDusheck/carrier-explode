/**
 * Fake r2.internal and control.internal on localhost, backed by a directory.
 * The r2 side is the Worker's own protocol handler over dirStore; the control
 * side records /done the way the Worker does (jobs/<id>.json).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { keys } from "../../src/lib/storage/keys.ts";
import type { JobRecord, JobSpec, Progress } from "../src/jobs.ts";
import { handleControl } from "../src/protocol/control.ts";
import { handleR2, type R2Scope } from "../src/protocol/r2.ts";
import { dirStore } from "./dir-store.ts";

/** A Node request as a fetch Request, body streamed. */
function toRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) for (const one of v) headers.append(k, one);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", origin), {
    method: req.method ?? "GET",
    headers,
    ...(hasBody ? { body: Readable.toWeb(req), duplex: "half" } : {}),
  });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) for await (const chunk of response.body) res.write(chunk);
  res.end();
}

function serve(handler: (req: Request) => Promise<Response>): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const origin = `http://${req.headers.host ?? "localhost"}`;
    handler(toRequest(req, origin))
      .then((response) => send(res, response))
      .catch((e: unknown) => {
        res.writeHead(500).end(e instanceof Error ? e.message : String(e));
      });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error(`not a TCP address: ${String(addr)}`);
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

export interface FakeServers {
  readonly r2: string;
  readonly control: string;
  close(): Promise<void>;
}

export interface FakeOptions {
  readonly dir: string;
  readonly spec: JobSpec;
  readonly scope: R2Scope;
  readonly onProgress?: (p: Progress) => void;
}

export async function startFakeServers(opts: FakeOptions): Promise<FakeServers> {
  const store = dirStore(opts.dir);
  const startedAt = new Date().toISOString();

  const r2 = await serve((req) => handleR2(req, store, opts.scope));
  const control = await serve((req) => handleControl(req, {
    progress: async (p) => opts.onProgress?.(p),
    async done(result) {
      const record: JobRecord = { spec: opts.spec, pipeline: "dev", instance: "dev", startedAt, finishedAt: new Date().toISOString(), result };
      const body = new TextEncoder().encode(JSON.stringify(record));
      await store.put(keys.job(opts.spec.id), new Blob([body]).stream(), body.length, { contentType: "application/json" });
    },
  }));

  const close = (s: Server): Promise<void> => new Promise((resolve, reject) => s.close((e) => (e ? reject(e) : resolve())));
  return {
    r2: r2.url,
    control: control.url,
    close: async () => {
      await Promise.all([close(r2.server), close(control.server)]);
    },
  };
}
