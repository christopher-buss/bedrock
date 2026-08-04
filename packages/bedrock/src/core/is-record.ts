/**
 * Narrows `value` to a plain JSON-style record. Excludes arrays, class
 * instances, primitives, and `null`/`undefined`. Used to gate property
 * access on values whose shape is not known at compile time: parsed wire
 * bodies, and emitter inputs typed as `unknown`.
 *
 * @param value - The unknown value to narrow.
 * @returns `true` when `value` is a plain `[object Object]`.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}
