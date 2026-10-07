/** The container's job server: the Extractor object posts one job to JOB_PATH and awaits its answer. Anything else (the readiness ping) gets an empty 200. */

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as v from "valibot";

import { describe } from "../../src/errors.ts";
import { CONTAINER_JOBS, JOB_PATH, JOB_PORT, type Answer } from "../../src/container-protocol.ts";
import { bucket } from "./bucket.ts";
import { failure } from "./job.ts";
import { JOBS } from "./jobs/index.ts";

const log = (line: string): void => {
	process.stdout.write(`${new Date().toISOString()} ${line}\n`);
};

const requestSchema = v.object({ job: v.picklist(CONTAINER_JOBS), params: v.unknown() });

async function text(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) if (Buffer.isBuffer(chunk)) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

/** Never throws: a job's failure is its answer. */
async function answer(body: string): Promise<Answer> {
	const tmp = await mkdtemp(join(tmpdir(), "job-"));
	try {
		const { job, params } = v.parse(requestSchema, JSON.parse(body));
		const run = JOBS[job];
		log(`${job}: start`);
		const output = await run(params, { tmp, bucket, log: (message) => log(`${job}: ${message}`) });
		log(`${job}: done`);
		return { ok: true, output };
	} catch (e) {
		log(`failed: ${e instanceof Error ? (e.stack ?? e.message) : describe(e)}`);
		return failure(e);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}

const server = createServer((req, res) => {
	if (req.method !== "POST" || req.url !== JOB_PATH) {
		res.writeHead(200).end();
		return;
	}
	text(req)
		.then(answer)
		.then((a) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(a)))
		.catch((e: unknown) => {
			log(`request failed: ${describe(e)}`);
			res.destroy();
		});
}).listen(JOB_PORT, () => log(`listening on ${JOB_PORT}`));

// As PID 1, node ignores SIGTERM unless it handles it, and the instance would run on until the platform's SIGKILL.
process.once("SIGTERM", () => {
	log("SIGTERM: exiting once the job in flight is answered");
	server.close(() => process.exit(0));
});
