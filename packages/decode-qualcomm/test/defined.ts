/** `v`, or a test failure when a lookup the test relies on found nothing. */
export function defined<T>(v: T | undefined): T {
	if (v === undefined) throw new Error("expected a value, got undefined");
	return v;
}
