import { ApiError, type OpenCloudError, requestContextOf } from "@bedrock-rbx/ocale";

import { isRecord } from "./is-record.ts";

const ON_SALE_LIMIT_FIELD = "isForSale";
const ON_SALE_LIMIT_PHRASE = "on-sale limit has already been reached";

/**
 * Open Cloud's `400` rejection of a game pass create or update that would put
 * the pass on sale while its universe already has the maximum number of game
 * passes on sale. Carries the original response (`code`, `details`,
 * `statusCode`) and request context unchanged, with the original
 * {@link ApiError} as its `cause`.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { ApiError } from "@bedrock-rbx/ocale";
 * import { GamePassOnSaleLimitError } from "@bedrock-rbx/core";
 *
 * const errorMessage =
 *     "The request parameter isForSale was invalid. Game pass on-sale limit has already been reached.";
 * const original = new ApiError(`HTTP 400: ${errorMessage}`, {
 *     details: { errorCode: "BadRequest", errorMessage, field: "isForSale" },
 *     statusCode: 400,
 * });
 * const err = new GamePassOnSaleLimitError(original);
 *
 * expect(err).toBeInstanceOf(ApiError);
 * expect(err.statusCode).toBe(400);
 * expect(err.cause).toBe(original);
 * ```
 */
export class GamePassOnSaleLimitError extends ApiError {
	public override readonly name: string = "GamePassOnSaleLimitError";

	/**
	 * Wraps the Open Cloud rejection.
	 *
	 * @param original - The `400` response that reported the on-sale limit.
	 */
	constructor(original: ApiError) {
		super(original.message, {
			...requestContextOf(original),
			cause: original,
			code: original.code,
			details: original.details,
			statusCode: original.statusCode,
		});
	}
}

/**
 * Recognizes Open Cloud's game pass on-sale-limit rejection and wraps it as a
 * {@link GamePassOnSaleLimitError}. Any other error is returned unchanged.
 *
 * @param err - The error a game pass create or update returned.
 * @returns The classified error, or `err` itself.
 */
export function classifyGamePassOnSaleLimit(err: OpenCloudError): OpenCloudError {
	return err instanceof ApiError && isOnSaleLimitRejection(err)
		? new GamePassOnSaleLimitError(err)
		: err;
}

function isOnSaleLimitRejection(err: ApiError): boolean {
	if (err.statusCode !== 400 || !isRecord(err.details)) {
		return false;
	}

	const { errorMessage, field } = err.details;
	return (
		field === ON_SALE_LIMIT_FIELD &&
		typeof errorMessage === "string" &&
		errorMessage.includes(ON_SALE_LIMIT_PHRASE)
	);
}
