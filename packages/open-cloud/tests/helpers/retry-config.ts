import { defaultRetryDelay, type RetryResolvable } from "#src/internal/http/retry";

/**
 * Builds a fully-populated {@link RetryResolvable} for tests. Every field
 * has a default, so adding a new required field to the interface breaks
 * this factory (one place, centrally) — forcing tests to opt into the new
 * shape.
 *
 * @param overrides - Fields to replace on the default fixture.
 * @returns A fresh RetryResolvable with `overrides` applied.
 */
export function makeRetryConfig(overrides: Partial<RetryResolvable> = {}): RetryResolvable {
	return {
		apiKey: "test-key",
		baseUrl: "https://test.example",
		maxRetries: 3,
		retryableStatuses: [429],
		retryableTransportCodes: [],
		retryDelay: defaultRetryDelay,
		timeout: 30_000,
		...overrides,
	};
}
