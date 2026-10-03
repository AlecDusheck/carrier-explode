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

export function kindOfMode(mode: number): FileKind {
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
  entries(dir: Node): Promise<DirEntry[]>;
  contents(file: Node): Promise<Uint8Array>;
}

export function pathFilesystem<Node>(kind: Filesystem["kind"], store: InodeStore<Node>): Filesystem {
  const lookup = async (path: string): Promise<Node> => {
    let node = await store.root();
    for (const part of path.split("/").filter((s) => s.length > 0)) {
      if (kindOfMode(store.mode(node)) !== "dir") throw new FsError(`${path}: ${part} is under a non-directory`);
      const hit = (await store.entries(node)).find((e) => e.name === part);
      if (!hit) throw new FsNotFoundError(`${path}: no ${part}`);
      node = await store.node(hit.inode);
    }
    return node;
  };
  return {
    kind,
    readdir: async (path) => {
      const node = await lookup(path);
      if (kindOfMode(store.mode(node)) !== "dir") throw new FsError(`${path} is not a directory`);
      return store.entries(node);
    },
    readFile: async (path) => {
      const node = await lookup(path);
      if (kindOfMode(store.mode(node)) !== "file") throw new FsError(`${path} is not a regular file`);
      return store.contents(node);
    },
  };
}
