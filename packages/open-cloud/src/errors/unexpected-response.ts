import { ApiError } from "./api-error.ts";

/**
 * Returned when Open Cloud answers with a status ocale accepts but a body
 * whose shape ocale's wire model rejects. The request reached the API and the
 * API did not refuse it, so the fault is more likely a stale wire model or a
 * parser bug in ocale than a problem with the caller's input. The raw body is
 * kept on {@link ApiError.details} so the mismatch can be reported.
 *
 * Subclass of {@link ApiError}: existing `instanceof ApiError` checks still
 * match. Branch on this class to tell a shape mismatch apart from an API
 * rejection.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { ApiError, UnexpectedResponseError } from "@bedrock-rbx/ocale";
 *
 * const error = new UnexpectedResponseError("Malformed badge response", {
 *     details: { id: "not-a-number" },
 *     statusCode: 200,
 * });
 *
 * expect(error).toBeInstanceOf(ApiError);
 * expect(error).toBeInstanceOf(UnexpectedResponseError);
 * expect(error.details).toStrictEqual({ id: "not-a-number" });
 * ```
 */
export class UnexpectedResponseError extends ApiError {
	public override readonly name: string = "UnexpectedResponseError";
}
