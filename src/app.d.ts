declare global {
  namespace App {
    interface Platform {
      env: { SYSTEM: R2Bucket };
      ctx: ExecutionContext;
      caches: CacheStorage & { default: Cache };
    }
  }
}

export {};
