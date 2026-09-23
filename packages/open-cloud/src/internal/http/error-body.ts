const CANONICAL_STATUS = /^[A-Z][A-Z0-9_]*$/;

/**
 * Permissively extracts a machine-readable error code from a response body.
 *
 * Four shapes are checked, in precedence order. Modern Open Cloud responses
 * use `{ errorCode: string, message: string }`; Cloud v2 resource endpoints
 * carry the canonical status in `code` (`{ code: "INVALID_ARGUMENT", message:
 * string }`); other v2 endpoints, such as memory-store queues, carry it in
 * `error` (`{ error: "NOT_FOUND", message: string }`); the legacy
 * game-internationalization endpoints use
 * `{ errors: [{ code: number, message: string }, ...] }`. Numeric legacy codes
 * are returned as strings so callers see one consistent type.
 *
 * `error` is read only when it holds an upper-snake-case token. A Google-style
 * nested envelope (`{ error: { code, message, status } }`) puts an object
 * there, and coercing that to a string would hand callers `"[object Object]"`
 * as a status. The server-management API puts a sentence there (`{ error:
 * "Place 1 does not belong to universe 2" }`), which
 * {@link extractErrorMessage} reads instead.
 *
 * @param body - The parsed response body (unknown shape).
 * @returns The error code if present, otherwise `undefined`.
 */
export function extractErrorCode(body: unknown): string | undefined {
	if (body === null || typeof body !== "object") {
		return undefined;
	}

	const errorCode = Reflect.get(body, "errorCode");
	if (typeof errorCode === "string") {
		return errorCode;
	}

	const v2Code = Reflect.get(body, "code");
	if (typeof v2Code === "string") {
		return v2Code;
	}

	const v2Error = readErrorField(body);
	if (v2Error !== undefined && CANONICAL_STATUS.test(v2Error)) {
		return v2Error;
	}

	return extractLegacyCode(body);
}

/**
 * Permissively extracts a human-readable error message from a response body.
 *
 * Modern Open Cloud responses expose `message` at the top level;
 * server-management business-rule errors put a sentence in `error`, and its
 * validation errors are ASP.NET ProblemDetails, read as the `title` followed
 * by the first field error in `errors`; the legacy game-internationalization
 * endpoints nest it under `errors[0].message`.
 *
 * @param body - The parsed response body (unknown shape).
 * @returns The message if present, otherwise `undefined`.
 */
export function extractErrorMessage(body: unknown): string | undefined {
	if (body === null || typeof body !== "object") {
		return undefined;
	}

	const message = Reflect.get(body, "message");
	if (typeof message === "string") {
		return message;
	}

	const errorSentence = readErrorField(body);
	if (errorSentence !== undefined && !CANONICAL_STATUS.test(errorSentence)) {
		return errorSentence;
	}

	return extractProblemDetailsMessage(body) ?? extractLegacyMessage(body);
}

function readErrorField(body: object): string | undefined {
	const error = Reflect.get(body, "error");
	return typeof error === "string" ? error : undefined;
}

function readLegacyErrorEntry(body: object): object | undefined {
	const errors = Reflect.get(body, "errors");
	if (!Array.isArray(errors)) {
		return undefined;
	}

	const [first] = errors;
	if (typeof first !== "object" || first === null) {
		return undefined;
	}

	return first;
}

function extractLegacyCode(body: object): string | undefined {
	const first = readLegacyErrorEntry(body);
	if (first === undefined) {
		return undefined;
	}

	const code = Reflect.get(first, "code");
	if (typeof code === "string") {
		return code;
	}

	return typeof code === "number" ? String(code) : undefined;
}

function readFirstFieldError(body: object): string | undefined {
	const errors = Reflect.get(body, "errors");
	if (typeof errors !== "object" || errors === null) {
		return undefined;
	}

	const [fieldErrors] = Object.values(errors);
	if (!Array.isArray(fieldErrors)) {
		return undefined;
	}

	const [first] = fieldErrors;
	return typeof first === "string" ? first : undefined;
}

function extractProblemDetailsMessage(body: object): string | undefined {
	const title = Reflect.get(body, "title");
	const fieldError = readFirstFieldError(body);
	if (typeof title !== "string") {
		return fieldError;
	}

	return fieldError === undefined ? title : `${title} ${fieldError}`;
}

function extractLegacyMessage(body: object): string | undefined {
	const first = readLegacyErrorEntry(body);
	if (first === undefined) {
		return undefined;
	}

	const message = Reflect.get(first, "message");
	return typeof message === "string" ? message : undefined;
}
