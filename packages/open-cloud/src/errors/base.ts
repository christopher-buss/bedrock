/**
 * Base error class for all Open Cloud SDK errors.
 *
 * All specific error types (RateLimitError, ApiError, NetworkError)
 * extend this class, enabling `instanceof OpenCloudError` checks.
 */
export class OpenCloudError extends Error {
	public override readonly name = "OpenCloudError";
}
