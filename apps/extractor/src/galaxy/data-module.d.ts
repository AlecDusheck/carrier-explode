/** A binary file imported as a module: an ArrayBuffer in the Worker (wrangler's Data rule), bytes in the container and tests (esbuild's and vitest's loaders). */
declare module "*.dat" {
	const bytes: ArrayBuffer | Uint8Array;
	export default bytes;
}
