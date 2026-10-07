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
	/** A regular file's bytes in order, a piece at a time: for files larger than memory. */
	readStream(path: string): AsyncIterable<Uint8Array>;
	/** A symlink's target, as stored. */
	readlink(path: string): Promise<string>;
}

/** The dirent file-type byte: ext4 and EROFS share the codes. */
export function kindOfDirent(type: number): FileKind {
	return type === 1 ? "file" : type === 2 ? "dir" : type === 7 ? "symlink" : "other";
}

function kindOfMode(mode: number): FileKind {
	switch (mode & 0xf000) {
		case 0x8000:
			return "file";
		case 0x4000:
			return "dir";
		case 0xa000:
			return "symlink";
		default:
			return "other";
	}
}

/** What a filesystem format provides; `pathFilesystem` adds path walking on top. */
export interface InodeStore<Node> {
	root(): Promise<Node>;
	node(inode: number): Promise<Node>;
	mode(node: Node): number;
	entries(dir: Node): Promise<readonly DirEntry[]>;
	size(node: Node): number;
	/** The node's bytes in order, holes as zeros. */
	stream(node: Node): AsyncIterable<Uint8Array>;
}

/** The most a file stream holds from one read: a longer extent is read in pieces this large. */
export const STREAM_PIECE = 1 << 20;

export async function* zeros(length: number): AsyncGenerator<Uint8Array> {
	for (let left = length; left > 0; left -= STREAM_PIECE) yield new Uint8Array(Math.min(left, STREAM_PIECE));
}

/** A stream's pieces in one buffer, which must come to exactly `size` bytes. */
export async function collect(
	pieces: AsyncIterable<Uint8Array>,
	size: number,
	label: string,
): Promise<Uint8Array> {
	const out = new Uint8Array(size);
	let at = 0;
	for await (const piece of pieces) {
		if (at + piece.length > size) throw new FsError(`${label}: more than its ${size} bytes`);
		out.set(piece, at);
		at += piece.length;
	}
	if (at !== size) throw new FsError(`${label}: ${at} of its ${size} bytes`);
	return out;
}

const KIND_NAMES = {
	file: "regular file",
	dir: "directory",
	symlink: "symbolic link",
} as const satisfies Record<Exclude<FileKind, "other">, string>;

const components = (path: string): string[] => path.split("/").filter((s) => s.length > 0);

export function pathFilesystem<Node>(
	kind: Exclude<Filesystem["kind"], "fat">,
	store: InodeStore<Node>,
): Filesystem {
	/** Directories' entries by path: over a payload partition, walking from the root for each file decompresses the same operations again. */
	const dirs = new Map<string, Promise<ReadonlyMap<string, DirEntry>>>();
	const entriesOf = (path: string, node: () => Promise<Node>): Promise<ReadonlyMap<string, DirEntry>> => {
		const known =
			dirs.get(path) ??
			node().then(async (n) => {
				if (kindOfMode(store.mode(n)) !== "dir") throw new FsError(`${path} is not a directory`);
				return new Map((await store.entries(n)).map((e) => [e.name, e]));
			});
		dirs.set(path, known);
		known.catch(() => dirs.delete(path));
		return known;
	};
	const lookup = async (path: string, want: Exclude<FileKind, "other">): Promise<Node> => {
		const parts = components(path);
		let node = (): Promise<Node> => store.root();
		for (const [i, part] of parts.entries()) {
			const hit = (await entriesOf(parts.slice(0, i).join("/"), node)).get(part);
			if (!hit) throw new FsNotFoundError(path, part);
			node = () => store.node(hit.inode);
		}
		const found = await node();
		if (kindOfMode(store.mode(found)) !== want) throw new FsError(`${path} is not a ${KIND_NAMES[want]}`);
		return found;
	};
	const contents = async (path: string, want: "file" | "symlink"): Promise<Uint8Array> => {
		const node = await lookup(path, want);
		return collect(store.stream(node), store.size(node), path);
	};
	return {
		kind,
		readdir: async (path) => [
			...(await entriesOf(components(path).join("/"), () => lookup(path, "dir"))).values(),
		],
		readFile: (path) => contents(path, "file"),
		async *readStream(path) {
			yield* store.stream(await lookup(path, "file"));
		},
		readlink: async (path) => new TextDecoder().decode(await contents(path, "symlink")),
	};
}
