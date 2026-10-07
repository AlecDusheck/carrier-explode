// The container's bucket client (../src/bucket.ts) against a server that closes idle connections, as the proxy does.

import { once } from "node:events";
import { Worker } from "node:worker_threads";

import { afterAll, describe, expect, it } from "vitest";

import { DataError } from "../../src/errors.ts";
import { bucketAt } from "../src/bucket.ts";
import { failure } from "../src/job.ts";

/** Answers each request with the status it is given and closes a connection idle for 50 ms, unannounced; on a thread of its own, so it closes while this one is held. */
const SERVER = `
  const { createServer } = require("node:net");
  const { parentPort, workerData: status } = require("node:worker_threads");
  const body = status === 201 ? "" : "refused";
  const server = createServer((socket) => {
    let seen = "";
    let idle;
    socket.on("data", (chunk) => {
      clearTimeout(idle);
      seen += chunk.toString("latin1");
      const end = seen.indexOf("\\r\\n\\r\\n");
      const length = Number(/content-length: (\\d+)/i.exec(seen)?.[1] ?? 0);
      if (end < 0 || seen.length < end + 4 + length) return;
      seen = seen.slice(end + 4 + length);
      socket.write("HTTP/1.1 " + status + " X\\r\\ncontent-length: " + body.length + "\\r\\n\\r\\n" + body);
      idle = setTimeout(() => socket.destroy(), 50);
    });
  });
  server.listen(0, "127.0.0.1", () => parentPort.postMessage(server.address().port));
`;

const servers: Worker[] = [];
afterAll(() => Promise.all(servers.map((w) => w.terminate())));

async function serve(status: number): Promise<number> {
	const worker = new Worker(SERVER, { eval: true, workerData: status });
	servers.push(worker);
	const [port]: unknown[] = await once(worker, "message");
	if (typeof port !== "number") throw new Error("the server sent no port");
	return port;
}

const putError = (port: number): Promise<unknown> =>
	bucketAt({ host: "127.0.0.1", port })
		.putOnce("tmp/u/a", "1", "application/json")
		.catch((e: unknown) => e);

/** Holds the event loop, as a long synchronous decode would, past the server's idle timeout. */
function block(ms: number): void {
	const until = performance.now() + ms;
	while (performance.now() < until);
}

describe("bucket", () => {
	it("puts again after the event loop was held past the server's idle timeout", async () => {
		const bucket = bucketAt({ host: "127.0.0.1", port: await serve(201) });
		expect(await bucket.putOnce("tmp/u/a", "1", "application/json")).toBe(true);
		block(300);
		expect(await bucket.putOnce("tmp/u/b", "2", "application/json")).toBe(true);
	});

	it("fails a refused request for good, and a failing bucket for a retry", async () => {
		expect(failure(await putError(await serve(400)))).toEqual({
			ok: false,
			error: "PUT tmp/u/a: 400 refused",
			permanent: true,
		});
		expect(failure(await putError(await serve(503)))).toMatchObject({ permanent: false });
	});
});

describe("failure", () => {
	it("calls a lost connection retryable and bad data permanent", () => {
		expect(failure(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toEqual({
			ok: false,
			error: "socket hang up",
			permanent: false,
		});
		expect(failure(new DataError("no BuildManifest.plist"))).toEqual({
			ok: false,
			error: "no BuildManifest.plist",
			permanent: true,
		});
	});
});
