/** A message without a field the format requires: without it, a record identifies nothing. */
export class MissingFieldError extends Error {
  override name = "MissingFieldError";
  /** Where the message sits (`entries[3].carrierIds[0]`; empty for the root). */
  readonly path: string;
  /** The proto field name. */
  readonly field: string;
  constructor(path: string, field: string) {
    super(`${path || "message"} has no ${field}`);
    this.path = path;
    this.field = field;
  }
}
