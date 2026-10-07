/** `v`, or a test failure when a lookup the test relies on found nothing. */
export function defined<T>(v: T | null | undefined): T {
	if (v === undefined || v === null) throw new Error(`expected a value, got ${v}`);
	return v;
}
