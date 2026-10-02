declare global {
  namespace App {
    interface Locals {
      /** Set by anything that reads the visitor. Keeps the response out of the shared cache. */
      perVisitor?: boolean;
    }
  }
}

export {};
