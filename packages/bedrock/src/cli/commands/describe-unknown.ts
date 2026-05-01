/**
 * Format a thrown value as a human-readable string for clack diagnostic
 * lines. Native `Error` instances surface their `message`; everything
 * else is coerced via `String()` so non-Error throws (rejection of a
 * primitive, for example) still render legibly.
 *
 * @param value - The caught value to describe.
 * @returns A short string suitable for inlining into a CLI error line.
 */
export function describeUnknown(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}
