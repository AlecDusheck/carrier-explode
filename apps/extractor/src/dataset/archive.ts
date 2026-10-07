/**
 * A zip written in one pass with no clock in it: entries in the order they are opened, every mtime the same, so the
 * same files give the same bytes. An entry may stay open while later ones are written; theirs wait, compressed.
 */

import { strToU8, Zip, ZipDeflate } from "fflate";

/** DOS time starts in 1980. */
const MTIME = "1980-01-01T00:00:00Z";

export interface OpenEntry {
	readonly write: (text: string) => void;
	readonly close: () => void;
}

export interface Archive {
	/** An entry to write a piece at a time. */
	readonly open: (path: string) => OpenEntry;
	/** A whole entry. */
	readonly file: (path: string, text: string) => void;
	/** Every entry closed: the archive's bytes. */
	readonly finish: () => Blob;
}

export function archive(): Archive {
	const out: Uint8Array[] = [];
	let ended = false;
	const zip = new Zip((error, chunk, final) => {
		if (error) throw error;
		out.push(chunk);
		ended = final;
	});
	const open = (path: string): OpenEntry => {
		const entry = new ZipDeflate(path);
		entry.mtime = MTIME;
		zip.add(entry);
		return { write: (text) => entry.push(strToU8(text)), close: () => entry.push(new Uint8Array(0), true) };
	};
	return {
		open,
		file: (path, text) => {
			const entry = open(path);
			entry.write(text);
			entry.close();
		},
		finish: () => {
			zip.end();
			if (!ended) throw new Error("archive: an entry is still open");
			return new Blob(out, { type: "application/zip" });
		},
	};
}
