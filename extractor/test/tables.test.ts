import { describe, expect, it } from "vitest";

import { JOB_TYPES, JOBS, parseJobSpec } from "../src/jobs.ts";
import { doneEvent, jobId, pipelineOfInstance } from "../src/worker/ids.ts";
import { PIPELINE_NAMES } from "../src/worker/pipelines.ts";

describe("job table", () => {
  it.each(JOB_TYPES)("%s writes whole prefixes, never jobs/ (the Worker's)", (type) => {
    for (const p of JOBS[type].writes) {
      expect(p.endsWith("/")).toBe(true);
      expect(p.startsWith("jobs/")).toBe(false);
    }
  });

  it("validates params by type", () => {
    expect(() => parseJobSpec({ id: "x:normalize:0", type: "normalize", params: { shas: ["nope"] } })).toThrow();
    expect(parseJobSpec({ id: "x:normalize:0", type: "normalize", params: { all: true, shard: 0, of: 4 } }).type).toBe("normalize");
    expect(() => parseJobSpec({ id: "x:bogus:0", type: "bogus", params: {} })).toThrow();
  });
});

describe("ids", () => {
  it("builds job ids and event types Workflows accept", () => {
    const id = jobId("ios-images-20261003T051700-ab12cd", "ios.ipsw", "23C55.iPhone17,1", 2);
    expect(id).toBe("ios-images-20261003T051700-ab12cd:ios.ipsw:23C55.iPhone17_1.r2");
    expect(doneEvent(id)).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
  });

  it("reads the pipeline back from an instance id", () => {
    expect(pipelineOfInstance("index-20261003T051700", PIPELINE_NAMES)).toBe("index");
    expect(pipelineOfInstance("ios-ota-20261003T051700", PIPELINE_NAMES)).toBe("ios-ota");
    expect(pipelineOfInstance("nope-1", PIPELINE_NAMES)).toBeUndefined();
  });
});
