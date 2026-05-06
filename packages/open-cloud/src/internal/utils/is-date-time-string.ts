/**
 * Narrows `value` to a string that parses to a real {@link Date} via the
 * `Date(string)` constructor. Used by resource parsers to gate
 * `format: date-time` wire fields before handing them to `new Date(...)`,
 * which silently produces an `Invalid Date` for invalid input.
 *
 * @param value - The unknown wire value to validate.
 * @returns `true` when `value` is a string and `new Date(value).getTime()`
 *   is not `NaN`.
 */
export function isDateTimeString(value: unknown): value is string {
	if (typeof value !== "string") {
		return false;
	}

	return !Number.isNaN(new Date(value).getTime());
}
