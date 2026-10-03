import type { JobTraits } from "../jobs.ts";

/** Containers a run may hold at once per class. Keep equal to wrangler.jsonc containers[].max_instances. */
export const MAX_INSTANCES = { heavy: 6, light: 16 } as const satisfies Record<JobTraits["size"], number>;
