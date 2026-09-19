declare global {
  namespace App {
    interface Locals {
      /** Set by anything that reads the visitor. Keeps the response out of the shared cache. */
      perVisitor?: boolean;
    }
    interface Platform {
      env: {
        SYSTEM: R2Bucket;
        /** Shared secret for /internal/purge; set with `wrangler secret put PURGE_TOKEN`. */
        PURGE_TOKEN?: string;
        /** Rate limiters, one budget each. Absent under `vite dev`, where the hook fails open. */
        RL_SCAN?: RateLimit;
        RL_DIFF?: RateLimit;
        RL_BUNDLE?: RateLimit;
        RL_BASE?: RateLimit;
      };
      ctx: ExecutionContext;
      cf?: IncomingRequestCfProperties;
      caches: CacheStorage & { default: Cache };
    }
  }
}

export {};
