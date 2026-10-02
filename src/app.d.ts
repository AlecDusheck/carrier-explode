declare global {
  namespace App {
    interface PageData {
      meta?: { title: string; description: string };
    }
    interface Locals {
      /** Set by anything that reads the visitor. Keeps the response out of the shared cache. */
      perVisitor?: boolean;
    }
  }
}

export {};
