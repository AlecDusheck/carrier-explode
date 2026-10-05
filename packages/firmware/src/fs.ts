/** What the filesystem readers share: the read-only interface, path walking, and errors. */

export class FsError extends Error {
  override name = "FsError";
}

/** A path component that does not exist: callers can tell "absent" from "unreadable". */
export class FsNotFoundError extends FsError {
  override name = "FsNotFoundError";
  readonly path: string;
  constructor(path: string, missing: string) {
    super(`${path}: no ${missing}`);
    this.path = path;
  }
}

export type FileKind = "file" | "dir" | "symlink" | "other";

export interface DirEntry {
  readonly name: string;
  /** ext4 inode number, EROFS nid, or FAT first cluster. */
  readonly inode: number;
  readonly kind: FileKind;
}

/** Paths are absolute within the image, `/` separated (`etc/CarrierSettings` works too). Symlinks are not followed. */
export interface Filesystem {
  readonly kind: "ext4" | "erofs" | "fat";
  readdir(path: string): Promise<readonly DirEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** A symlink's target, as stored. */
  readlink(path: string): Promise<string>;
}

/** The dirent file-type byte: ext4 and EROFS share the codes. */
export function kindOfDirent(type: number): FileKind {
  return type === 1 ? "file" : type === 2 ? "dir" : type === 7 ? "symlink" : "other";
}

function kindOfMode(mode: number): FileKind {
  switch (mode & 0xf000) {
    case 0x8000: return "file";
    case 0x4000: return "dir";
    case 0xa000: return "symlink";
    default: return "other";
  }
}

/** What a filesystem format provides; `pathFilesystem` adds path walking on top. */
export interface InodeStore<Node> {
  root(): Promise<Node>;
  node(inode: number): Promise<Node>;
  mode(node: Node): number;
  entries(dir: Node): Promise<readonly DirEntry[]>;
  contents(file: Node): Promise<Uint8Array>;
}

const KIND_NAMES = { file: "regular file", dir: "directory", symlink: "symbolic link" } as const satisfies Record<Exclude<FileKind, "other">, string>;

export function pathFilesystem<Node>(kind: Exclude<Filesystem["kind"], "fat">, store: InodeStore<Node>): Filesystem {
  const lookup = async (path: string, want: Exclude<FileKind, "other">): Promise<Node> => {
    let node = await store.root();
    for (const part of path.split("/").filter((s) => s.length > 0)) {
      if (kindOfMode(store.mode(node)) !== "dir") throw new FsError(`${path}: ${part} is under a non-directory`);
      const hit = (await store.entries(node)).find((e) => e.name === part);
      if (!hit) throw new FsNotFoundError(path, part);
      node = await store.node(hit.inode);
    }
    if (kindOfMode(store.mode(node)) !== want) throw new FsError(`${path} is not a ${KIND_NAMES[want]}`);
    return node;
  };
  return {
    kind,
    readdir: async (path) => store.entries(await lookup(path, "dir")),
    readFile: async (path) => store.contents(await lookup(path, "file")),
    readlink: async (path) => new TextDecoder().decode(await store.contents(await lookup(path, "symlink"))),
  };
}
