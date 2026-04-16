import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import { computeRetryWaitMs, defaultRetryDelay, shouldRetry } from "./retry.ts";

describe(defaultRetryDelay, () => {
	it("should return 1000ms for attempt 0", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(0)).toBe(1000);
	});

	it("should return 2000ms for attempt 1", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(1)).toBe(2000);
	});

	it("should return 4000ms for attempt 2", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(2)).toBe(4000);
	});

	it("should return 8000ms for attempt 3", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(3)).toBe(8000);
	});

	it("should cap at 30000ms for large attempts", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(10)).toBe(30_000);
	});
});

describe(computeRetryWaitMs, () => {
	it("should return retryAfterSeconds * 1000 for RateLimitError with positive retryAfterSeconds", () => {
		expect.assertions(2);

		const retryDelay = vi.fn<(attempt: number) => number>(() => 99_999);
		const error = new RateLimitError("slow down", { retryAfterSeconds: 3 });

		expect(computeRetryWaitMs(error, { attempt: 0, retryDelay })).toBe(3000);
		expect(retryDelay).not.toHaveBeenCalled();
	});

	it("should fall back to retryDelay when RateLimitError.retryAfterSeconds is 0", () => {
		expect.assertions(2);

		const retryDelay = vi.fn<(attempt: number) => number>((attempt) => 1000 * (attempt + 1));
		const error = new RateLimitError("slow down", { retryAfterSeconds: 0 });

		expect(computeRetryWaitMs(error, { attempt: 2, retryDelay })).toBe(3000);
		expect(retryDelay).toHaveBeenCalledWith(2);
	});

	it("should fall back to retryDelay when error is an ApiError", () => {
		expect.assertions(2);

		const retryDelay = vi.fn<(attempt: number) => number>((attempt) => 500 * (attempt + 1));
		const error = new ApiError("server error", { statusCode: 503 });

		expect(computeRetryWaitMs(error, { attempt: 1, retryDelay })).toBe(1000);
		expect(retryDelay).toHaveBeenCalledWith(1);
	});

	it("should pass the attempt index through to the retryDelay function", () => {
		expect.assertions(1);

		const retryDelay = vi.fn<(attempt: number) => number>(() => 0);
		const error = new ApiError("server error", { statusCode: 500 });

		computeRetryWaitMs(error, { attempt: 7, retryDelay });

		expect(retryDelay).toHaveBeenCalledWith(7);
	});
});

describe(shouldRetry, () => {
	it("should return true for RateLimitError when 429 is in retryableStatuses", () => {
		expect.assertions(1);

		const error = new RateLimitError("slow down", { retryAfterSeconds: 1 });

		expect(shouldRetry(error, { retryableStatuses: [429, 500] })).toBe(true);
	});

	it("should return false for RateLimitError when 429 is not in retryableStatuses", () => {
		expect.assertions(1);

		const error = new RateLimitError("slow down", { retryAfterSeconds: 1 });

		expect(shouldRetry(error, { retryableStatuses: [500, 502] })).toBe(false);
	});

	it("should return true for ApiError when its statusCode is in retryableStatuses", () => {
		expect.assertions(1);

		const error = new ApiError("unavailable", { statusCode: 503 });

		expect(shouldRetry(error, { retryableStatuses: [429, 500, 502, 503, 504] })).toBe(true);
	});

	it("should return false for ApiError when its statusCode is not in retryableStatuses", () => {
		expect.assertions(1);

		const error = new ApiError("bad request", { statusCode: 400 });

		expect(shouldRetry(error, { retryableStatuses: [429, 500] })).toBe(false);
	});

	it("should return false for NetworkError", () => {
		expect.assertions(1);

		const error = new NetworkError("offline");

		expect(shouldRetry(error, { retryableStatuses: [429, 500] })).toBe(false);
	});

	it("should return false for a plain Error", () => {
		expect.assertions(1);

		expect(shouldRetry(new Error("boom"), { retryableStatuses: [429] })).toBe(false);
	});

	it("should return false for non-Error values", () => {
		expect.assertions(3);

		expect(shouldRetry(null, { retryableStatuses: [429] })).toBe(false);
		expect(shouldRetry("oops", { retryableStatuses: [429] })).toBe(false);
		expect(shouldRetry(undefined, { retryableStatuses: [429] })).toBe(false);
	});
});
