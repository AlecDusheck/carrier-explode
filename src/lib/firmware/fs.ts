/** What the filesystem readers share: the read-only interface and its errors. */

export class FsError extends Error {
  override name = "FsError";
}

/** A path component that does not exist: callers can tell "absent" from "unreadable". */
export class FsNotFoundError extends FsError {
  override name = "FsNotFoundError";
}

export type FileKind = "file" | "dir" | "symlink" | "other";

export interface DirEntry {
  readonly name: string;
  /** ext4 inode number, or EROFS nid. */
  readonly inode: number;
  readonly kind: FileKind;
}

/** Paths are absolute within the image, `/` separated (`etc/CarrierSettings` works too). Symlinks are not followed. */
export interface Filesystem {
  readonly kind: "ext4" | "erofs";
  readdir(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
}
