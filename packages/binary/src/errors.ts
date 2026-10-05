/** The message of a thrown value, which TypeScript types as `unknown`: an Error's own message, else its string form. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
