import type { ConfigValidationIssue } from "./config-error.ts";
import type { ConfigValidator } from "./schema.ts";

const RECEIVED_UNDEFINED = "(was undefined)";

const RECEIVED_NULL = "(was null)";

interface NullScan {
	/** Keys of every path where a `null` was replaced. */
	readonly nullPaths: Set<string>;
	/** Path from the config root to the value being scanned. */
	readonly path: ReadonlyArray<string>;
}

/**
 * Wrap a config validator so it reads every JSON or YAML `null` as
 * `undefined`. The key stays present, so a `null` on an optional overlay
 * field clears the inherited root value the same way an explicit
 * `undefined` does in a TypeScript config. A `null` on a field that does not
 * accept `undefined` still fails validation, and the issue names `null` as
 * the received value so the message matches what the author wrote.
 *
 * @param validate - Schema validator to run on the normalized config.
 * @returns A validator with the same contract that accepts `null`.
 */
export function withNullAsUndefined(validate: ConfigValidator): ConfigValidator {
	return function validateWithNullAsUndefined(input, sourceFile) {
		const nullPaths = new Set<string>();
		const validated = validate(replaceNulls(input, { nullPaths, path: [] }), sourceFile);
		if (validated.success || validated.err.kind !== "validationFailed") {
			return validated;
		}

		return {
			err: {
				...validated.err,
				issues: validated.err.issues.map((issue) => attributeNull(issue, nullPaths)),
			},
			success: false,
		};
	};
}

function pathKey(path: ReadonlyArray<string>): string {
	return JSON.stringify(path);
}

function replaceNulls(value: unknown, { nullPaths, path }: NullScan): unknown {
	if (value === null) {
		nullPaths.add(pathKey(path));
		return undefined;
	}

	if (Array.isArray(value)) {
		return value.map((item: unknown, index) => {
			return replaceNulls(item, { nullPaths, path: [...path, String(index)] });
		});
	}

	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => {
				return [key, replaceNulls(item, { nullPaths, path: [...path, key] })];
			}),
		);
	}

	return value;
}

function attributeNull(
	issue: ConfigValidationIssue,
	nullPaths: ReadonlySet<string>,
): ConfigValidationIssue {
	if (!nullPaths.has(pathKey(issue.path)) || !issue.message.endsWith(RECEIVED_UNDEFINED)) {
		return issue;
	}

	return {
		...issue,
		message: issue.message.slice(0, -RECEIVED_UNDEFINED.length) + RECEIVED_NULL,
	};
}
