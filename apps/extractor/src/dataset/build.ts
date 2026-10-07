/**
 * The dataset: the public API's answers, read through its service binding and written as they are, and each Pixel and
 * Galaxy head's settings in AOSP's XML. Entries come in a fixed order, so the same answers give the same archive.
 */

import * as v from "valibot";

import { decodeCarrierSettings, type CarrierSettings } from "@carrier-explode/decode-android";
import {
	AOSP_DOCUMENTS,
	apnElements,
	baseSource,
	carrierConfigElements,
	pixelApns,
	pixelConfigBody,
	profileApns,
} from "@carrier-explode/schema";
import { profileSchema, sha256Schema, sourceKeySchema } from "@carrier-explode/schema/records";
import {
	buildsPath,
	listPath,
	parseRuleKey,
	PLATFORMS,
	RELEASE_PLATFORMS,
	shipsKind,
	SOURCE_KINDS,
	sourceOf,
	sourcePath,
	type SimRule,
	type SourceRef,
} from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import type { Env } from "../env.ts";
import { chunks } from "../fan-out.ts";
import { CONNECTIONS, readBytes } from "../store.ts";
import { archive, type OpenEntry } from "./archive.ts";
import LICENSE from "./LICENSE.txt";
import README from "./README.md";

/** The binding routes by itself: the host is never looked up. */
const ORIGIN = "https://api";
const PAGE = 500;
/** A head's parts the archive carries: never its native settings. */
const HEAD = "/versions/latest?fields=apns,concepts,identity";

type Api = Env["API"];

async function answer(api: Api, path: string): Promise<string> {
	const r = await api.fetch(`${ORIGIN}${path}`, { redirect: "manual" });
	const text = await r.text();
	if (r.status !== 200) throw new Error(`GET ${path}: ${r.status} ${text.slice(0, 300)}`);
	return text;
}

const parsed = <S extends v.GenericSchema>(schema: S, path: string, text: string): v.InferOutput<S> => {
	const raw: unknown = JSON.parse(text);
	const result = v.safeParse(schema, raw);
	if (!result.success) throw new Error(`GET ${path}: ${v.summarize(result.issues)}`);
	return result.output;
};

const pageSchema = v.looseObject({
	items: v.array(v.unknown()),
	next: v.nullable(v.object({ url: v.string() })),
});

/** A paged list read whole: its first page's answer, with every page's items and no next. */
async function whole(api: Api, path: string): Promise<{ readonly text: string; readonly items: unknown[] }> {
	let url: string | null = `${path}?limit=${PAGE}`;
	let first: v.InferOutput<typeof pageSchema> | undefined;
	const items: unknown[] = [];
	while (url !== null) {
		const page: v.InferOutput<typeof pageSchema> = parsed(pageSchema, url, await answer(api, url));
		first ??= page;
		items.push(...page.items);
		const next = page.next === null ? null : new URL(page.next.url);
		url = next === null ? null : next.pathname + next.search;
	}
	return { text: JSON.stringify({ ...first, items, next: null }), items };
}

const sourceAnswer = v.object({
	selectedBy: v.object({ claimed: v.array(v.string()), routed: v.array(v.string()) }),
});
const headAnswer = v.object({
	entry: v.object({ sha: sha256Schema }),
	profile: v.object({ apns: profileSchema.entries.apns }),
});

function rulesOf(path: string, text: string): SimRule[] {
	const { selectedBy } = parsed(sourceAnswer, path, text);
	return [...new Set([...selectedBy.claimed, ...selectedBy.routed])].map((key) => {
		const rule = parseRuleKey(key);
		if (rule === undefined) throw new Error(`GET ${path}: ${key} is not a rule key`);
		return rule;
	});
}

/** The AOSP documents, open while the API's answers are written. */
interface Xml {
	readonly pixelApns: OpenEntry;
	readonly pixelConfig: OpenEntry;
	readonly galaxyApns: OpenEntry;
}

const headOf = async (api: Api, ref: SourceRef): Promise<string> =>
	answer(api, `/v1${sourcePath(ref)}${HEAD}`);

async function pixelSettings(env: Pick<Env, "BUCKET">, path: string, head: string): Promise<CarrierSettings> {
	const { entry } = parsed(headAnswer, path, head);
	return decodeCarrierSettings(await readBytes(env.BUCKET, keys.obj(entry.sha)));
}

/** A source and its head, as files, and its part of the AOSP documents. */
async function sourceFiles(
	env: Pick<Env, "API" | "BUCKET">,
	ref: SourceRef,
): Promise<{ readonly files: ReadonlyArray<readonly [string, string]>; readonly xml: (x: Xml) => void }> {
	const path = `/v1${sourcePath(ref)}`;
	const [source, head] = await Promise.all([answer(env.API, path), headOf(env.API, ref)]);
	const files = [
		[`v1${sourcePath(ref)}.json`, source],
		[`v1${sourcePath(ref)}/versions/latest.json`, head],
	] as const;
	if (ref.kind !== "carrier") return { files, xml: () => undefined };
	switch (ref.platform) {
		case "android": {
			const rules = rulesOf(path, source);
			const cs = await pixelSettings(env, `${path}${HEAD}`, head);
			return {
				files,
				xml: (x) => {
					x.pixelApns.write(apnElements(rules, pixelApns(cs, ref.name)));
					x.pixelConfig.write(carrierConfigElements(ref.name, rules, pixelConfigBody(cs)));
				},
			};
		}
		case "samsung": {
			const rules = rulesOf(path, source);
			const { profile } = parsed(headAnswer, `${path}${HEAD}`, head);
			return {
				files,
				xml: (x) => x.galaxyApns.write(apnElements(rules, profileApns(profile.apns, ref.name))),
			};
		}
		default:
			return { files, xml: () => undefined };
	}
}

/** An answer's path in the zip: the API's, but the Pixel platform is `pixel`, as the site names it to people. */
const entryPath = (apiPath: string): string => apiPath.replace(/^v1\/android\//, "v1/pixel/");

const listItem = v.object({ key: sourceKeySchema });
const buildItem = v.object({ devices: v.array(v.string()) });

/** The archive, built from the API's answers now. */
export async function buildDataset(env: Pick<Env, "API" | "BUCKET">): Promise<Blob> {
	const zip = archive();
	const put = (apiPath: string, text: string): void => zip.file(entryPath(apiPath), text);
	zip.file("README.md", README);
	zip.file("LICENSE", LICENSE);
	const xml: Xml = {
		pixelApns: zip.open("pixel/apns-conf.xml"),
		pixelConfig: zip.open("pixel/carrier-config-list.xml"),
		galaxyApns: zip.open("samsung/apns-conf.xml"),
	};
	xml.pixelApns.write(AOSP_DOCUMENTS.apnsConf.head);
	xml.pixelConfig.write(AOSP_DOCUMENTS.carrierConfigList.head);
	xml.galaxyApns.write(AOSP_DOCUMENTS.apnsConf.head);

	const base = baseSource("android");
	if (base === null) throw new Error("android: no base source");
	const baseRef = sourceOf(base);
	const baseHead = await headOf(env.API, baseRef);
	const baseSettings = await pixelSettings(env, `/v1${sourcePath(baseRef)}${HEAD}`, baseHead);
	xml.pixelConfig.write(carrierConfigElements(baseRef.name, "every SIM", pixelConfigBody(baseSettings)));

	for (const name of ["platforms", "concepts"]) put(`v1/${name}.json`, await answer(env.API, `/v1/${name}`));
	for (const name of ["carriers", "countries", "devices"])
		put(`v1/${name}.json`, (await whole(env.API, `/v1/${name}`)).text);

	const read = new Set<string>();
	for (const platform of RELEASE_PLATFORMS) {
		const builds = await whole(env.API, `/v1${buildsPath(platform)}`);
		put(`v1${buildsPath(platform)}.json`, builds.text);
		for (const b of builds.items) for (const d of v.parse(buildItem, b).devices) read.add(d);
	}
	for (const code of [...read].toSorted())
		put(`v1/devices/${code}/features.json`, (await whole(env.API, `/v1/devices/${code}/features`)).text);

	for (const platform of PLATFORMS)
		for (const kind of SOURCE_KINDS) {
			if (!shipsKind(platform, kind)) continue;
			const list = await whole(env.API, `/v1${listPath(platform, kind)}`);
			put(`v1${listPath(platform, kind)}.json`, list.text);
			const refs = list.items.map((i) => sourceOf(v.parse(listItem, i).key));
			for (const batch of chunks(refs, CONNECTIONS))
				for (const s of await Promise.all(batch.map((ref) => sourceFiles(env, ref)))) {
					for (const [path, text] of s.files) put(path, text);
					s.xml(xml);
				}
		}

	xml.pixelApns.write(AOSP_DOCUMENTS.apnsConf.tail);
	xml.pixelConfig.write(AOSP_DOCUMENTS.carrierConfigList.tail);
	xml.galaxyApns.write(AOSP_DOCUMENTS.apnsConf.tail);
	for (const entry of Object.values(xml)) entry.close();
	return zip.finish();
}
