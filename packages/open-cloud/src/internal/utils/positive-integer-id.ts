const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

/**
 * Parses a stringified Roblox ID for a wire field typed as an integer.
 *
 * @param value - The stringified ID.
 * @returns The ID as a number, or `undefined` when it is not a positive
 *   integer within the safe-integer range.
 */
export function parsePositiveIntegerId(value: string): number | undefined {
	if (!POSITIVE_INTEGER_PATTERN.test(value)) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}
