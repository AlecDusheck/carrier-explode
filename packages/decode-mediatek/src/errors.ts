/** What an MCF file broke. Reads past the end surface as the binary package's BoundsError. */
type McfErrorCode = "magic" | "kind" | "layout" | "checksum" | "tag" | "path";

/** A malformed or unsupported MediaTek MCF file. */
export class McfError extends Error {
  override name = "McfError";
  readonly code: McfErrorCode;
  /** File offset of the header, section or record at fault. */
  readonly offset: number;
  constructor(code: McfErrorCode, offset: number, message: string) {
    super(`${message} (at ${offset})`);
    this.code = code;
    this.offset = offset;
  }
}
