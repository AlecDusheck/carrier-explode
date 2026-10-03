/**
 * Where the runtime finds R2 and control. In a deployed container these are
 * made-up hosts the Worker's outbound handlers answer; the dev harness points
 * them at its fake server through the same variables.
 */

export interface Endpoints {
  readonly r2: string;
  readonly control: string;
}

export function endpointsFromEnv(env: NodeJS.ProcessEnv): Endpoints {
  return {
    r2: env["EXTRACTOR_R2_URL"] ?? "http://r2.internal",
    control: env["EXTRACTOR_CONTROL_URL"] ?? "http://control.internal",
  };
}
