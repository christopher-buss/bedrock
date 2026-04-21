/**
 * Narrows `value` to a plain JSON-style record. Excludes arrays, class
 * instances, primitives, and `null`/`undefined`. Used by resource
 * parsers to gate property access on wire bodies whose shape isn't
 * known at compile time.
 *
 * @param value - The unknown value to narrow.
 * @returns `true` when `value` is a plain `[object Object]`.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}
