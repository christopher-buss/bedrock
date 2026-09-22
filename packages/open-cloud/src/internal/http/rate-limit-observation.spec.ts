import { describe, expect, it } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import { markServerRetryGuidance, RateLimitError } from "../../errors/rate-limit.ts";
import { rateLimitSampleFromResult } from "./rate-limit-observation.ts";

describe(rateLimitSampleFromResult, () => {
	it("should parse the headers of a successful response", () => {
		expect.assertions(1);

		const result = rateLimitSampleFromResult({
			data: {
				body: undefined,
				headers: { "x-ratelimit-remaining": "97", "x-ratelimit-reset": "23" },
				status: 200,
			},
			success: true,
		});

		expect(result).toStrictEqual({ remaining: 97, resetSeconds: 23 });
	});

	it("should return undefined for a success without rate-limit headers", () => {
		expect.assertions(1);

		const result = rateLimitSampleFromResult({
			data: { body: undefined, headers: {}, status: 200 },
			success: true,
		});

		expect(result).toBeUndefined();
	});

	it("should build a sample from a rate-limit error carrying remaining", () => {
		expect.assertions(1);

		const result = rateLimitSampleFromResult({
			err: markServerRetryGuidance(
				new RateLimitError("Rate limited", { remaining: 0, retryAfterSeconds: 22 }),
			),
			success: false,
		});

		expect(result).toStrictEqual({ remaining: 0, resetSeconds: 22 });
	});

	it("should not turn a 429 with reported budget remaining into a budget wait", () => {
		expect.assertions(1);

		const result = rateLimitSampleFromResult({
			err: markServerRetryGuidance(
				new RateLimitError("Place capacity occupied", {
					remaining: 3,
					retryAfterSeconds: 5,
				}),
			),
			success: false,
		});

		expect(result).toBeUndefined();
	});

	it("should return undefined for a rate-limit error without remaining", () => {
		expect.assertions(1);

		const result = rateLimitSampleFromResult({
			err: new RateLimitError("Rate limited", { retryAfterSeconds: 5 }),
			success: false,
		});

		expect(result).toBeUndefined();
	});

	it("should return undefined for an unguided rate-limit error with zero remaining", () => {
		expect.assertions(1);

		const result = rateLimitSampleFromResult({
			err: new RateLimitError("Rate limited", { remaining: 0, retryAfterSeconds: 0 }),
			success: false,
		});

		expect(result).toBeUndefined();
	});

	it("should return undefined for a non-rate-limit error", () => {
		expect.assertions(1);

		const result = rateLimitSampleFromResult({
			err: new ApiError("boom", { statusCode: 500 }),
			success: false,
		});

		expect(result).toBeUndefined();
	});
});
