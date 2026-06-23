/**
 * Base error class for all Open Cloud SDK errors.
 *
 * All specific error types (RateLimitError, ApiError, NetworkError)
 * extend this class, enabling `instanceof OpenCloudError` checks.
 *
 * @since 0.1.0
 */
export class OpenCloudError extends Error {
	public override readonly name: string = "OpenCloudError";
}
