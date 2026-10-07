/**
 * The two queues. The index queue's consumer runs one message at a time, so two units never derive a shared source
 * from different snapshots. A purge batch is one purge per reader: the readers' cache purges share the account's
 * bucket of 25, refilled 5 a minute.
 */

import * as v from "valibot";

import { indexDb } from "@carrier-explode/db";
import { HttpError } from "@carrier-explode/http";
import type { ReleasePlatform } from "@carrier-explode/schema/types";
import { PURGE_PATH } from "@carrier-explode/storage";
import type { Env } from "./env.ts";
import { delayOf, indexMessageSchema, indexUnit, type IndexMessage } from "./indexing.ts";

/** Each queue the Worker consumes, in either environment, by what it carries. */
export const QUEUES = {
	"carrier-explode-index": "index",
	"carrier-explode-purge": "purge",
	"carrier-explode-index-dev": "index",
	"carrier-explode-purge-dev": "purge",
} as const satisfies Record<string, "index" | "purge">;

/** What the consumers reach. */
export type QueueEnv = Pick<
	Env,
	"DB" | "BUCKET" | "INDEX_QUEUE" | "PURGE_QUEUE" | "PURGE_ORIGINS" | "PURGE_TOKEN"
>;

/** sendBatch takes at most 100 messages, and 256 KB of them together: measured as JSON, with room for the encoding's overhead. */
const SEND_BATCH = 100;
const SEND_BYTES = 200_000;

/** `messages` in runs one sendBatch takes. */
export function sendBatches<T>(messages: readonly T[]): T[][] {
	const out: T[][] = [];
	let batch: T[] = [];
	let bytes = 0;
	for (const m of messages) {
		const size = JSON.stringify(m).length;
		if (batch.length === SEND_BATCH || (batch.length > 0 && bytes + size > SEND_BYTES)) {
			out.push(batch);
			batch = [];
			bytes = 0;
		}
		batch.push(m);
		bytes += size;
	}
	if (batch.length > 0) out.push(batch);
	return out;
}

export async function queueIndex(
	env: Pick<Env, "INDEX_QUEUE">,
	messages: readonly IndexMessage[],
): Promise<void> {
	for (const batch of sendBatches(messages))
		await env.INDEX_QUEUE.sendBatch(batch.map((body) => ({ body, delaySeconds: delayOf(body) })));
}

/** A purge names nothing: the readers tag every response alike, so each purge drops them all. */
export type PurgeMessage = Readonly<Record<string, never>>;

export async function queuePurge(env: Pick<Env, "PURGE_QUEUE">): Promise<void> {
	await env.PURGE_QUEUE.send({} satisfies PurgeMessage);
}

/**
 * After a feed check wrote its platform's devices and their names: a device's release day or boards decide heads and
 * phone states, so the platform is derived again; either shows on pages, which are purged.
 */
export async function devicesSynced(
	env: Pick<Env, "INDEX_QUEUE" | "PURGE_QUEUE">,
	platform: ReleasePlatform,
	changed: { readonly devices: number; readonly names: number },
): Promise<void> {
	if (changed.devices > 0) await queueIndex(env, [{ kind: "rederive", platform }]);
	if (changed.devices + changed.names > 0) await queuePurge(env);
}

/** The readers' origins (a var) and the bearer they share (a secret), as the environment holds them, unchecked. */
export type PurgeVars = Readonly<Record<"PURGE_ORIGINS" | "PURGE_TOKEN", unknown>>;

/** Where purges go: nowhere until both vars are set, or each reader's PURGE_PATH with the bearer. */
type PurgeTarget =
	| { readonly purge: "off" }
	| { readonly purge: "readers"; readonly urls: readonly string[]; readonly token: string };

const originsSchema = v.optional(v.array(v.pipe(v.string(), v.url())), []);
const tokenSchema = v.optional(v.pipe(v.string(), v.minLength(1)));

/** The environment's purge vars, checked. Half of the pair is a misconfiguration, and throws. */
export function purgeTarget(env: PurgeVars): PurgeTarget {
	const origins = v.parse(originsSchema, env.PURGE_ORIGINS);
	const token = v.parse(tokenSchema, env.PURGE_TOKEN);
	if (origins.length && token !== undefined)
		return { purge: "readers", urls: origins.map((o) => new URL(PURGE_PATH, o).href), token };
	if (origins.length)
		throw new Error(
			"PURGE_ORIGINS is set but PURGE_TOKEN is not: `wrangler secret put PURGE_TOKEN`, or remove PURGE_ORIGINS",
		);
	if (token !== undefined) throw new Error("PURGE_TOKEN is set but PURGE_ORIGINS is not");
	return { purge: "off" };
}

/**
 * One request to each reader, which purges its own cache. Not retried here: each try spends a purge from the account's
 * bucket, so the purge queue retries the batch after a delay.
 */
async function purgeReaders(env: PurgeVars): Promise<void> {
	const target = purgeTarget(env);
	if (target.purge === "off") return;
	await Promise.all(
		target.urls.map(async (url) => {
			// SvelteKit refuses a cross-site POST without a content type as a form submission.
			const res = await fetch(url, {
				method: "POST",
				headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" },
				body: "{}",
			});
			await res.body?.cancel();
			if (!res.ok) throw new HttpError(url, res.status);
		}),
	);
}

/** Each message indexed in turn; what it hands on and what it changed are queued before it is acknowledged. */
async function consumeIndex(batch: MessageBatch, env: QueueEnv): Promise<void> {
	const ctx = { db: indexDb(env.DB), bucket: env.BUCKET };
	for (const message of batch.messages) {
		const done = await indexUnit(ctx, v.parse(indexMessageSchema, message.body));
		if (done.next !== null) await queueIndex(env, [done.next]);
		if (done.wrote) await queuePurge(env);
		message.ack();
	}
}

/** One purge per reader for the whole batch; a failure retries the batch. */
async function consumePurge(batch: MessageBatch, env: QueueEnv): Promise<void> {
	await purgeReaders(env);
	batch.ackAll();
}

export async function queue(batch: MessageBatch, env: QueueEnv): Promise<void> {
	const role = Object.entries(QUEUES).find(([name]) => name === batch.queue)?.[1];
	switch (role) {
		case "index":
			return consumeIndex(batch, env);
		case "purge":
			return consumePurge(batch, env);
		case undefined:
			throw new Error(`${batch.queue}: not a queue this Worker consumes`);
	}
}
