import type { SourceKey } from "@carrier-explode/schema/types";
import type { PageNames } from "#lib/types.ts";

declare global {
  namespace App {
    interface PageData {
      /** The root layout's: what the head calls the codes in the URL. */
      names: PageNames;
      meta?: { title: string; description: string };
      /** A page reachable at several URLs (one file on several Pixels) names the one to index. */
      canonical?: string;
    }
    interface Error {
      status: number;
      message: string;
      /** A page holding what was asked for: a v1 URL's source, when its version is unknown. */
      elsewhere?: string;
    }
    interface Locals {
      /** Set by anything that reads the visitor. Keeps the response out of the shared cache. */
      perVisitor?: boolean;
      /** The sources the response read: its cache tags, so a publish purges only what it changed. */
      sources: Set<SourceKey>;
      /** A v1 URL whose version the redirect table lacks: what its 404 says. */
      moved?: { readonly message: string; readonly elsewhere: string };
    }
  }
}

export {};
