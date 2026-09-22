import { describe, expect, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { RetryDelayExceededError } from "./retry-delay-exceeded.ts";

describe(RetryDelayExceededError, () => {
	it("should expose the refused retry delay and remaining deadline budget", () => {
		expect.assertions(3);

		const cause = new Error("rate limited");
		const error = new RetryDelayExceededError("Retry delay exceeds the configured limit", {
			cause,
			deadlineMs: 1_000_000,
			remainingMs: 495_000,
			retryAfterMs: 1_856_000,
		});

		expect(error).toBeInstanceOf(OpenCloudError);
		expect(error.name).toBe("RetryDelayExceededError");
		expect({
			cause: error.cause,
			deadlineMs: error.deadlineMs,
			remainingMs: error.remainingMs,
			retryAfterMs: error.retryAfterMs,
			retryAfterSeconds: error.retryAfterSeconds,
		}).toStrictEqual({
			cause,
			deadlineMs: 1_000_000,
			remainingMs: 495_000,
			retryAfterMs: 1_856_000,
			retryAfterSeconds: 1856,
		});
	});
});
