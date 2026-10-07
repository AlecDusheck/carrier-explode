import { isRecord } from "@carrier-explode/values";

/** `v`, or a test failure when a lookup the test relies on found nothing. */
export function defined<T>(v: T | null | undefined): T {
	if (v === undefined || v === null) throw new Error(`expected a value, got ${v}`);
	return v;
}

/** `v` as a record, or a test failure when it is not one. */
export function record(v: unknown): Record<string, unknown> {
	if (!isRecord(v)) throw new Error(`expected a record, got ${typeof v}`);
	return v;
}

/** `v` as an array, or a test failure when it is not one. */
export function array(v: unknown): unknown[] {
	if (!Array.isArray(v)) throw new Error(`expected an array, got ${typeof v}`);
	return v;
}
