/** ios.ota: Apple's OTA files, downloaded and stored as Apple serves them; pages compare them with the digests Apple states. */

import { contentId, openIpcc } from "@carrier-explode/decode-ios";
import { fetchApple } from "@carrier-explode/http";
import { fanOut } from "../../../src/fan-out.ts";
import type { JobContext } from "../job.ts";
import type { JobOutput } from "../../../src/jobs.ts";

/** Parallel downloads from Apple. */
const DOWNLOADS = 6;

export async function iosOta(ctx: JobContext<"ios.ota">): Promise<JobOutput<"ios.ota">> {
  const { urls } = ctx.spec.params;
  let done = 0;
  const results = await fanOut(urls, DOWNLOADS, async (url) => {
    const bytes = await fetchApple(url);
    const cid = await contentId(openIpcc(bytes));
    const sha = await ctx.r2.putObj(bytes, { kind: "apple.ipcc", cid, origin: { kind: "download", url } });
    await ctx.progress(++done, urls.length);
    return { url, sha, cid };
  });
  return {
    stored: results.flatMap((r) => (r.ok ? [r.value] : [])),
    failed: results.flatMap((r) => (r.ok ? [] : [{ url: r.item, error: r.error }])),
  };
}
