import { ValidationError, type ValidationErrorCode } from "../../errors/validation.ts";
import type { Result } from "../../types.ts";

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

/**
 * Names the parameter an ID list came from, for the error it may produce.
 */
export interface IdListField {
	/** Validation code reported for an entry that is not an ID. */
	readonly code: ValidationErrorCode;
	/** Parameter name quoted in the error message. */
	readonly field: string;
}

/**
 * Parses stringified Roblox IDs for a wire field typed as an integer array.
 *
 * @param ids - The stringified IDs.
 * @param field - The parameter the IDs came from.
 * @returns The IDs as numbers, or a {@link ValidationError} naming the
 *   first entry that is not a positive integer within the safe-integer
 *   range.
 */
export function parsePositiveIntegerIds(
	ids: ReadonlyArray<string>,
	{ code, field }: IdListField,
): Result<ReadonlyArray<number>, ValidationError> {
	const parsed: Array<number> = [];
	for (const id of ids) {
		const value = parsePositiveIntegerId(id);
		if (value === undefined) {
			const message = `${field} entry ${JSON.stringify(id)} is not a positive integer ID`;
			return { err: new ValidationError(message, { code }), success: false };
		}

		parsed.push(value);
	}

	return { data: parsed, success: true };
}

function parsePositiveIntegerId(value: string): number | undefined {
	if (!POSITIVE_INTEGER_PATTERN.test(value)) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}
