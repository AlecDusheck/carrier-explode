/** Errors as one line, and those that are the caller's fault, with their status; anything else at a handler's edge is a 500. */

/** An error as one line, with an AggregateError's causes. */
export function describe(e: unknown): string {
  if (e instanceof AggregateError) return `${e.message} (${e.errors.map(describe).join("; ")})`;
  return e instanceof Error ? e.message : String(e);
}

export class RequestError extends Error {
  override name = "RequestError";
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The response for a thrown value: its own status for a RequestError, 500 (and a log line) otherwise. */
export function errorResponse(e: unknown): Response {
  if (e instanceof RequestError) return Response.json({ error: e.message }, { status: e.status });
  // Unexpected: keep the stack in the Worker's logs, give the caller the message.
  console.error(e);
  return Response.json({ error: describe(e) }, { status: 500 });
}
