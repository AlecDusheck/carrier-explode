/**
 * Errors that are the caller's fault or a definite answer, with the HTTP
 * status they map to. Anything else reaching a handler's edge is a 500.
 */

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
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}
