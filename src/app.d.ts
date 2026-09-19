declare global {
  namespace App {
    interface Locals {
      /** Set by anything that reads the visitor. Keeps the response out of the shared cache. */
      perVisitor?: boolean;
    }
    interface Platform {
      env: { SYSTEM: R2Bucket };
      ctx: ExecutionContext;
      cf?: IncomingRequestCfProperties;
      caches: CacheStorage & { default: Cache };
    }
  }
}

export {};
