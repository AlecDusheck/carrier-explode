import { readFile } from "node:fs/promises";

import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { JOB_TYPES, JOBS, parseJobSpec } from "../src/jobs.ts";
import { instanceId, jobId, pipelineOfInstance, timedInstanceId } from "../src/worker/ids.ts";
import { FEED_NAMES, FEEDS, LABELS_CRON, PIPELINE_NAMES, PIPELINES } from "../src/worker/pipelines.ts";
import { tuningSchema } from "../src/worker/tuning.ts";

describe("job table", () => {
  it.each(JOB_TYPES)("%s writes and deletes whole prefixes, never jobs/, and never deletes artifacts", (type) => {
    const { writes, deletes } = JOBS[type];
    for (const p of [...writes, ...deletes]) {
      expect(p.endsWith("/")).toBe(true);
      expect(p.startsWith("jobs/")).toBe(false);
    }
    expect(deletes).not.toContain("obj/");
    expect(deletes).not.toContain("meta/");
  });

  it("validates params by type", () => {
    expect(() => parseJobSpec({ id: "x:normalize:0", type: "normalize", params: { shas: ["nope"] } })).toThrow();
    expect(parseJobSpec({ id: "x:normalize:0", type: "normalize", params: { shard: 0, of: 4, boards: { d93: "iPhone17,1" } } }).type).toBe("normalize");
    expect(() => parseJobSpec({ id: "x:bogus:0", type: "bogus", params: {} })).toThrow();
  });
});

describe("ids", () => {
  it("names an instance by its unit, in the characters Workflows accept", () => {
    expect(instanceId("android-build", "CP3A.260905.009")).toBe("android-build-CP3A_260905_009");
    expect(timedInstanceId("publish", new Date("2026-10-03T05:17:00Z"))).toMatch(/^publish-20261003T051700-[0-9a-f]{6}$/);
  });

  it("builds job ids from the instance, type and unit", () => {
    expect(jobId("ios-build-24A446", "ios.ipsw", "iPhone17,1", 2)).toBe("ios-build-24A446:ios.ipsw:iPhone17_1.r2");
  });

  it("reads the pipeline back from an instance id", () => {
    expect(pipelineOfInstance("ios-ota-0123")).toBe("ios-ota");
    expect(pipelineOfInstance("publish-20261003T051700-ab12cd")).toBe("publish");
    expect(pipelineOfInstance("nope-1")).toBeUndefined();
  });
});

/** The parts of wrangler.jsonc the Worker's tables must agree with. */
const wranglerSchema = v.object({
  workflows: v.array(v.object({ binding: v.string(), name: v.string() })),
  triggers: v.object({ crons: v.array(v.string()) }),
  vars: v.record(v.string(), v.unknown()),
});

/** JSONC to JSON: comments go, strings (which hold `//` in URLs) stay. */
const stripComments = (text: string): string => text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, str: string | undefined) => str ?? "");

describe("wrangler.jsonc", async () => {
  const config = v.parse(wranglerSchema, JSON.parse(stripComments(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"))));

  it("sets the tuning the Worker reads, in its shape", () => {
    expect(v.safeParse(tuningSchema, config.vars).issues).toBeUndefined();
  });

  it("schedules exactly the feeds' crons and the labels run's", () => {
    const crons = [...new Set([...FEED_NAMES.map((f) => FEEDS[f].cron), LABELS_CRON])];
    expect([...config.triggers.crons].sort()).toEqual(crons.sort());
  });

  it("binds one Workflow per pipeline, named after it", () => {
    const bound = config.workflows.map((w) => [w.name, w.binding]).sort();
    expect(bound).toEqual(PIPELINE_NAMES.map((p) => [p, PIPELINES[p].binding]).sort());
  });
});
