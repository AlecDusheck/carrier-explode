/**
 * carrier-explode — server side.
 *
 * Every byte that reaches the browser is fetched, verified and decoded here;
 * the client never talks to Apple directly. See lib/cache.ts for the caching
 * strategy.
 */

import {
  MANIFEST_URL, parseManifest, buildIndex, buildMccMnc, carrierRefs,
  countryName, splitName,
  type ManifestIndex, type BundleRef, type MccMncEntry,
} from "./lib/manifest.ts";
import { openIpcc, decodeFile, contentTypeOf, type BundleInfo } from "./lib/ipcc.ts";
import { normalizeApplePng } from "./lib/png.ts";
import { buildCbsMatrix, latestPerCountry } from "./lib/cbs.ts";
import { diffValues, summariseDiff } from "./lib/diff.ts";
import { keyScan, scanTargets } from "./lib/keyscan.ts";
import { memo, dropMemo, cachedJson, fetchUpstream, assertAppleUrl, HttpError, sha1Hex, sha384Hex } from "./lib/cache.ts";

/** Bumped whenever a response shape changes, so stale cached JSON is not served. */
const API_VERSION = "v4";

const MANIFEST_TTL_MS = 6 * 60 * 60 * 1000;
const DAY = 86400;

interface ManifestState {
  index: ManifestIndex;
  refs: Record<string, BundleRef[]>;
  mccmnc: { entries: MccMncEntry[]; carrierIds: Array<[string, string]> };
  manifestBytes: number;
}

/** Parse the 6 MB manifest once per warm isolate and keep only the derived views. */
async function manifestState(): Promise<ManifestState> {
  return memo("manifest", MANIFEST_TTL_MS, async () => {
    const res = await fetch(MANIFEST_URL, {
      cf: { cacheTtl: 21600, cacheEverything: true },
      headers: { "user-agent": "carrier-explode/1.0 (+bundle inspector)" },
    } as RequestInit);
    if (!res.ok) throw new HttpError(502, `manifest fetch failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const root = parseManifest(bytes);
    const index = buildIndex(root);
    const refs: Record<string, BundleRef[]> = {};
    for (const c of index.carriers) refs[c.name] = carrierRefs(root, c.name);
    for (const c of index.watchCarriers) if (!refs[c.name]) refs[c.name] = carrierRefs(root, c.name);
    return { index, refs, mccmnc: buildMccMnc(root), manifestBytes: bytes.length };
  });
}

function json(data: unknown, ttl = 300): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${Math.min(ttl, 3600)}, s-maxage=${ttl}`,
    },
  });
}

function errorResponse(e: unknown): Response {
  const status = e instanceof HttpError ? e.status : 500;
  const message = e instanceof Error ? e.message : String(e);
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Download + unzip an .ipcc, memoised per URL. */
async function openBundle(url: string) {
  const u = assertAppleUrl(url).toString();
  return memo(`ipcc:${u}`, 30 * 60 * 1000, async () => {
    const bytes = await fetchUpstream(u);
    const opened = openIpcc(bytes);
    return { opened, size: bytes.length, sha1: await sha1Hex(bytes), sha384: await sha384Hex(bytes) };
  });
}

interface BundlePayload {
  url: string;
  downloadSize: number;
  sha1: string;
  sha384: string;
  digestMatch?: { sha1: boolean; sha384?: boolean };
  info: BundleInfo;
  quick: Record<string, unknown>;
  ref?: BundleRef & { carrier?: string };
}

async function bundlePayload(url: string, ref?: BundleRef & { carrier?: string }): Promise<BundlePayload> {
  const { opened, size, sha1, sha384 } = await openBundle(url);
  const quick: Record<string, unknown> = {};
  for (const name of ["carrier.plist", "Info.plist", "version.plist"]) {
    if (opened.info.files.some((f) => f.path === name)) {
      try { quick[name] = decodeFile(opened, name).plist; } catch { /* keep going */ }
    }
  }
  const payload: BundlePayload = {
    url, downloadSize: size, sha1, sha384, info: opened.info, quick, ref,
  };
  if (ref?.digest || ref?.digest3) {
    payload.digestMatch = {
      sha1: ref.digest ? ref.digest.toLowerCase() === sha1 : false,
      sha384: ref.digest3 ? ref.digest3.toLowerCase() === sha384 : undefined,
    };
  }
  return payload;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      switch (path) {
        case "/api/index": {
          return cachedJson(`index:${API_VERSION}`, 6 * 3600, ctx, async () => {
            const st = await manifestState();
            return { ...st.index, manifestBytes: st.manifestBytes, manifestUrl: MANIFEST_URL };
          });
        }

        case "/api/mccmnc": {
          return cachedJson(`mccmnc:${API_VERSION}`, 6 * 3600, ctx, async () => (await manifestState()).mccmnc);
        }

        case "/api/carrier": {
          const name = url.searchParams.get("name");
          if (!name) throw new HttpError(400, "name required");
          const st = await manifestState();
          const summary =
            st.index.carriers.find((c) => c.name === name) ??
            st.index.watchCarriers.find((c) => c.name === name);
          const refs = st.refs[name];
          if (!summary && !refs?.length) throw new HttpError(404, `unknown carrier: ${name}`);
          const { cc } = splitName(name);
          return json(
            { summary, refs: refs ?? [], country: { cc, name: countryName(cc) } },
            6 * 3600,
          );
        }

        case "/api/bundle": {
          const src = url.searchParams.get("url");
          if (!src) throw new HttpError(400, "url required");
          const carrier = url.searchParams.get("carrier") ?? undefined;
          return cachedJson(`bundle:${API_VERSION}:${src}`, 30 * DAY, ctx, async () => {
            const st = await manifestState();
            let ref: (BundleRef & { carrier?: string }) | undefined;
            if (carrier) ref = st.refs[carrier]?.find((r) => r.url === src);
            if (!ref) {
              for (const c of st.index.countries) {
                if (c.url === src) { ref = { os: c.minOS ?? "", build: c.version, url: c.url, productType: c.family }; break; }
              }
            }
            return bundlePayload(src, ref ? { ...ref, carrier } : undefined);
          });
        }

        case "/api/file": {
          const src = url.searchParams.get("url");
          const file = url.searchParams.get("path");
          if (!src || !file) throw new HttpError(400, "url and path required");
          return cachedJson(`file:${API_VERSION}:${src}#${file}`, 30 * DAY, ctx, async () => {
            const { opened } = await openBundle(src);
            return decodeFile(opened, file);
          });
        }

        case "/api/cbs": {
          const family = url.searchParams.get("family") === "Watch" ? "Watch" : "iPhone";
          return cachedJson(`cbs:${API_VERSION}:${family}`, 7 * DAY, ctx, async () => {
            const st = await manifestState();
            return buildCbsMatrix(st.index.countries, fetchUpstream, family);
          });
        }

        case "/api/countries": {
          return cachedJson(`countries:${API_VERSION}`, 6 * 3600, ctx, async () => {
            const st = await manifestState();
            return {
              iPhone: latestPerCountry(st.index.countries, "iPhone"),
              Watch: latestPerCountry(st.index.countries, "Watch"),
              all: st.index.countries,
            };
          });
        }

        case "/api/diff": {
          const a = url.searchParams.get("a");
          const b = url.searchParams.get("b");
          const file = url.searchParams.get("path") ?? "carrier.plist";
          if (!a || !b) throw new HttpError(400, "a and b required");
          return cachedJson(`diff:${API_VERSION}:${a}|${b}|${file}`, 30 * DAY, ctx, async () => {
            const [A, B] = await Promise.all([openBundle(a), openBundle(b)]);
            const pick = (o: Awaited<ReturnType<typeof openBundle>>) => {
              try {
                const d = decodeFile(o.opened, file);
                return d.plist ?? d.pri ?? d.text ?? null;
              } catch {
                return null;
              }
            };
            const rows = diffValues(pick(A), pick(B));
            return {
              path: file, a, b, rows, counts: summariseDiff(rows),
              aFiles: A.opened.info.files.map((f) => f.path),
              bFiles: B.opened.info.files.map((f) => f.path),
            };
          });
        }

        case "/api/keyscan": {
          const keyPath = url.searchParams.get("path");
          if (!keyPath) throw new HttpError(400, "path required");
          const scope = url.searchParams.get("scope") ?? "countries";
          const file = url.searchParams.get("file") ?? "carrier.plist";
          const limit = Number(url.searchParams.get("limit") ?? 40) || 40;
          return cachedJson(`keyscan:${API_VERSION}:${scope}|${file}|${keyPath}|${limit}`, 7 * DAY, ctx, async () => {
            const st = await manifestState();
            const targets = scanTargets(scope, st.index.carriers, st.refs, st.index.countries);
            return keyScan(targets, file, keyPath, fetchUpstream, scope, limit);
          });
        }

        case "/api/raw": {
          const src = url.searchParams.get("url");
          const file = url.searchParams.get("path");
          if (!src || !file) throw new HttpError(400, "url and path required");
          const { opened } = await openBundle(src);
          const stored = opened.entries[opened.prefix + file] ?? opened.entries[file];
          if (!stored) throw new HttpError(404, `no such file in bundle: ${file}`);
          // Carrier logos ship in Apple's CgBI PNG variant, which no browser renders.
          const bytes = normalizeApplePng(stored) ?? stored;
          const name = file.split("/").pop() || "file";
          const download = url.searchParams.get("dl") === "1";
          return new Response(bytes as unknown as BodyInit, {
            headers: {
              "content-type": contentTypeOf(file),
              "content-disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/"/g, "")}"`,
              "cache-control": `public, max-age=${30 * DAY}, immutable`,
              "x-content-type-options": "nosniff",
            },
          });
        }

        case "/api/download": {
          const src = url.searchParams.get("url");
          if (!src) throw new HttpError(400, "url required");
          const u = assertAppleUrl(src);
          const bytes = await fetchUpstream(u.toString());
          const name = u.pathname.split("/").pop() || "bundle.ipcc";
          return new Response(bytes as unknown as BodyInit, {
            headers: {
              "content-type": "application/octet-stream",
              "content-disposition": `attachment; filename="${name}"`,
              "cache-control": `public, max-age=${30 * DAY}, immutable`,
            },
          });
        }

        case "/api/refresh": {
          const n = dropMemo();
          return json({ dropped: n }, 0);
        }

        default:
          throw new HttpError(404, `no route for ${path}`);
      }
    } catch (e) {
      return errorResponse(e);
    }
  },
} satisfies ExportedHandler<Env>;
