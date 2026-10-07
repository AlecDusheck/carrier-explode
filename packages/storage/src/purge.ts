/** How the extractor drops what each reader of the store (the site, the API) has cached, at its PURGE_PATH. */

/** Every reader serves its purge here, on its own origin, behind the one PURGE_TOKEN. */
export const PURGE_PATH = "/internal/purge";

/**
 * The tag on every response a reader caches. Every page shows lists of the whole index, and a link or a name shows in
 * any response, so a purge drops them all.
 */
export const INDEX_TAG = "index";
