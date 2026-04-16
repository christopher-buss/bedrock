import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import {
	computeRetryWaitMs,
	CREATE_METHOD_DEFAULTS,
	defaultRetryDelay,
	IDEMPOTENT_METHOD_DEFAULTS,
	mergeConfig,
	type RetryResolvable,
	shouldRetry,
} from "./retry.ts";

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

describe("cREATE_METHOD_DEFAULTS", () => {
	it("should expose retryableStatuses of [429] only", () => {
		expect.assertions(1);

		expect(CREATE_METHOD_DEFAULTS.retryableStatuses).toStrictEqual([429]);
	});
});

describe("iDEMPOTENT_METHOD_DEFAULTS", () => {
	it("should expose retryableStatuses of [429, 500, 502, 503, 504]", () => {
		expect.assertions(1);

		expect(IDEMPOTENT_METHOD_DEFAULTS.retryableStatuses).toStrictEqual([
			429, 500, 502, 503, 504,
		]);
	});
});

describe(mergeConfig, () => {
	describe("create methods", () => {
		it("should have method defaults override client config (create-guard)", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = {
				apiKey: "k",
				retryableStatuses: [429, 500],
			};

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
			});

			expect(merged.retryableStatuses).toStrictEqual([429]);
		});

		it("should have requestOptions override method defaults", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = {
				apiKey: "k",
				retryableStatuses: [429, 500],
			};

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { retryableStatuses: [429, 500, 503] },
			});

			expect(merged.retryableStatuses).toStrictEqual([429, 500, 503]);
		});

		it("should keep client apiKey when method defaults do not supply one", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = { apiKey: "client-key" };

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
			});

			expect(merged.apiKey).toBe("client-key");
		});

		it("should let requestOptions override client apiKey", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = { apiKey: "client-key" };

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { apiKey: "request-key" },
			});

			expect(merged.apiKey).toBe("request-key");
		});

		it("should let requestOptions override client baseUrl", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = {
				apiKey: "k",
				baseUrl: "https://client.example",
			};

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { baseUrl: "https://request.example" },
			});

			expect(merged.baseUrl).toBe("https://request.example");
		});

		it("should let requestOptions override client timeout", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = { apiKey: "k", timeout: 5_000 };

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { timeout: 20_000 },
			});

			expect(merged.timeout).toBe(20_000);
		});

		it("should let requestOptions override client maxRetries", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = { apiKey: "k", maxRetries: 3 };

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { maxRetries: 0 },
			});

			expect(merged.maxRetries).toBe(0);
		});
	});

	describe("idempotent methods", () => {
		it("should have client config override method defaults", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = {
				apiKey: "k",
				retryableStatuses: [429, 500],
			};

			const merged = mergeConfig(clientConfig, {
				methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
				methodKind: "idempotent",
			});

			expect(merged.retryableStatuses).toStrictEqual([429, 500]);
		});

		it("should fall through to method defaults when client has no retryableStatuses", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = { apiKey: "k" };

			const merged = mergeConfig(clientConfig, {
				methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
				methodKind: "idempotent",
			});

			expect(merged.retryableStatuses).toStrictEqual([429, 500, 502, 503, 504]);
		});

		it("should have requestOptions override client config", () => {
			expect.assertions(1);

			const clientConfig: RetryResolvable = {
				apiKey: "k",
				retryableStatuses: [429, 500],
			};

			const merged = mergeConfig(clientConfig, {
				methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
				methodKind: "idempotent",
				requestOptions: { retryableStatuses: [503] },
			});

			expect(merged.retryableStatuses).toStrictEqual([503]);
		});
	});

	it("should not mutate the input clientConfig", () => {
		expect.assertions(2);

		const clientConfig: RetryResolvable = {
			apiKey: "client-key",
			retryableStatuses: [429, 500],
		};
		const snapshot = { ...clientConfig };

		mergeConfig(clientConfig, {
			methodDefaults: CREATE_METHOD_DEFAULTS,
			methodKind: "create",
			requestOptions: { apiKey: "request-key", retryableStatuses: [503] },
		});

		expect(clientConfig).toStrictEqual(snapshot);
		expect(clientConfig.retryableStatuses).toStrictEqual([429, 500]);
	});
});
