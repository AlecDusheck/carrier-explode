/**
 * The one container class, for the two jobs a Worker step cannot do: an IPSW's root filesystem and a Galaxy AP member.
 * A step awaits one `run(job)` RPC; the container's bucket requests are served here.
 */

import { Container } from "@cloudflare/containers";
import * as v from "valibot";

import { serveBucket } from "./bucket-proxy.ts";
import {
	answerSchema,
	BUCKET_HOST,
	JOB_PATH,
	JOB_PORT,
	type Answer,
	type ContainerJob,
} from "./container-protocol.ts";
import type { Env } from "./env.ts";

/** The job's output as JSON text, which its unit validates; or why it failed. */
export type ContainerAnswer =
	| { readonly ok: true; readonly output: string }
	| Readonly<Extract<Answer, { ok: false }>>;

const JOB_URL = `http://container:${JOB_PORT}${JOB_PATH}`;
/** The image is a few hundred MB, and a cold start pulls it. */
const READY_MS = 120_000;

/** How long one job may run: about twice the slowest whole IPSW, so a hung job's container is gone within the hour. */
export const JOB_DEADLINE_MS = 58 * 60_000;

/** `work` given `ms` to settle, then `cleanup` either way; past the deadline it rejects, whether or not `work` heeds the signal. */
async function withinDeadline<T>(
	ms: number,
	work: (signal: AbortSignal) => Promise<T>,
	cleanup: () => Promise<void>,
): Promise<T> {
	const deadline = new AbortController();
	const expired = new Promise<never>((_, reject) => {
		deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason), { once: true });
	});
	const timer = setTimeout(() => deadline.abort(new Error(`no answer within ${ms} ms`)), ms);
	try {
		return await Promise.race([work(deadline.signal), expired]);
	} finally {
		clearTimeout(timer);
		await cleanup();
	}
}

/** How long a container with no request in flight lives on. */
export const SLEEP_AFTER = "5m";

export class Extractor extends Container<Env> {
	// Assigned, not declared: the base class's setter registers the handler with the class's outbound proxy.
	static {
		this.outboundByHost = { [BUCKET_HOST]: (req: Request, env: Env) => serveBucket(req, env.BUCKET) };
	}

	override defaultPort = JOB_PORT;
	/** Downloads from Apple and Samsung. */
	override enableInternet = true;
	/**
	 * The job's deadline is a timer in this object's memory; an object evicted mid-job restarts on its alarm with no request
	 * in flight, and stops the container once it has been idle this long.
	 */
	override sleepAfter = SLEEP_AFTER;

	/**
	 * Runs one job, the only one this object's container ever gets, to its answer within JOB_DEADLINE_MS, then destroys the
	 * container. A rejection (the deadline, the container killed, the connection lost) is the caller's to retry.
	 */
	run(job: ContainerJob): Promise<ContainerAnswer> {
		return withinDeadline(
			JOB_DEADLINE_MS,
			async (signal) => {
				await this.startAndWaitForPorts({
					cancellationOptions: { portReadyTimeoutMS: READY_MS, abort: signal },
				});
				const res = await this.containerFetch(JOB_URL, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(job),
					signal,
				});
				if (!res.ok)
					throw new Error(`${job.job}: the job server answered ${res.status}: ${await res.text()}`);
				const answer = v.parse(answerSchema, await res.json());
				return answer.ok ? { ok: true, output: JSON.stringify(answer.output) } : answer;
			},
			() => this.destroy(),
		);
	}
}
