/** fetch with retries and backoff, Range reads, and downloads from Apple's hosts with the http↔https fallback old ones need. */

export { fetchApple, isAppleHost } from "./apple.ts";
export {
	contentLength,
	fetchRange,
	fetchWithRetry,
	HttpError,
	RangeResponseError,
	type RetryOptions,
} from "./fetch.ts";
export { streamRange } from "./range-stream.ts";
