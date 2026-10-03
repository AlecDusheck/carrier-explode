declare global {
  namespace App {
    interface PageData {
      meta?: { title: string; description: string };
      /** A page reachable at several URLs (one file on several Pixels) names the one to index. */
      canonical?: string;
    }
    interface Locals {
      /** Set by anything that reads the visitor. Keeps the response out of the shared cache. */
      perVisitor?: boolean;
    }
  }
}

export {};
