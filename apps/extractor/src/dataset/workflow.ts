/** Once a day: the dataset built from the API's answers, and stored under one key when its bytes changed. */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import * as v from "valibot";

import { datasetMetadataSchema, keys, type DatasetMetadata } from "@carrier-explode/storage";
import type { Env } from "../env.ts";
import { PIPELINES } from "../pipelines.ts";
import { queuePurge } from "../queues.ts";
import { doStep } from "../unit.ts";
import { buildDataset } from "./build.ts";

const hex = (digest: ArrayBuffer): string =>
	[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(blob: Blob): Promise<string> {
	const digest = new crypto.DigestStream("SHA-256");
	await blob.stream().pipeTo(digest);
	return hex(await digest.digest);
}

/** The archive built now, put unless the one held has the same bytes; `date` is the day its contents last changed. */
async function publishDataset(
	env: Pick<Env, "API" | "BUCKET">,
	day: string,
): Promise<DatasetMetadata & { readonly changed: boolean }> {
	const blob = await buildDataset(env);
	const digest = await sha256(blob);
	const held = await env.BUCKET.head(keys.dataset());
	const previous = held === null ? null : v.parse(datasetMetadataSchema, held.customMetadata);
	if (previous?.sha256 === digest) return { ...previous, changed: false };
	const metadata: DatasetMetadata = { date: day, sha256: digest, size: String(blob.size) };
	await env.BUCKET.put(keys.dataset(), blob, {
		httpMetadata: { contentType: "application/zip" },
		customMetadata: metadata,
		sha256: digest,
	});
	return { ...metadata, changed: true };
}

export class DatasetWorkflow extends WorkflowEntrypoint<Env, unknown> {
	override async run(
		event: Readonly<WorkflowEvent<unknown>>,
		step: WorkflowStep,
	): Promise<DatasetMetadata & { readonly changed: boolean }> {
		const { day } = v.parse(PIPELINES.dataset.params, event.payload);
		const published = await doStep(step, "build", this.env, () => publishDataset(this.env, day));
		if (published.changed) await doStep(step, "purge", this.env, () => queuePurge(this.env));
		return published;
	}
}
