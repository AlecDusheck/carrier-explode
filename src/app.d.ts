declare global {
  namespace App {
    interface Platform {
      env: { SYSTEM: R2Bucket };
      ctx: ExecutionContext;
      cf?: IncomingRequestCfProperties;
      caches: CacheStorage & { default: Cache };
    }
  }
}

export {};
