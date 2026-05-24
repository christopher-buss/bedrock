import { makeRetryConfig } from "#tests/helpers/retry-config";
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
	type MethodKind,
	shouldRetry,
} from "./retry.ts";

describe(defaultRetryDelay, () => {
	it.for<[attempt: number, expected: number]>([
		[0, 1000],
		[1, 2000],
		[2, 4000],
		[3, 8000],
	])("should double the wait on each attempt (attempt %i → %ims)", ([attempt, expected]) => {
		expect.assertions(1);

		expect(defaultRetryDelay(attempt)).toBe(expected);
	});

	it("should cap the wait at 30 seconds once backoff exceeds it", () => {
		expect.assertions(1);

		expect(defaultRetryDelay(10)).toBe(30_000);
	});
});

describe(computeRetryWaitMs, () => {
	it("should honor the server-supplied retry-after hint when present", () => {
		expect.assertions(2);

		const retryDelay = vi.fn<(attempt: number) => number>(() => 99_999);
		const error = new RateLimitError("slow down", { retryAfterSeconds: 3 });

		expect(computeRetryWaitMs(error, { attempt: 0, retryDelay })).toBe(3000);
		expect(retryDelay).not.toHaveBeenCalled();
	});

	it("should fall back to the retryDelay function when RateLimitError has no server hint", () => {
		expect.assertions(2);

		const retryDelay = vi.fn<(attempt: number) => number>((attempt) => 1000 * (attempt + 1));
		const error = new RateLimitError("slow down", { retryAfterSeconds: 0 });

		expect(computeRetryWaitMs(error, { attempt: 2, retryDelay })).toBe(3000);
		expect(retryDelay).toHaveBeenCalledWith(2);
	});

	it("should fall back to the retryDelay function for non-rate-limit errors", () => {
		expect.assertions(2);

		const retryDelay = vi.fn<(attempt: number) => number>((attempt) => 500 * (attempt + 1));
		const error = new ApiError("server error", { statusCode: 503 });

		expect(computeRetryWaitMs(error, { attempt: 1, retryDelay })).toBe(1000);
		expect(retryDelay).toHaveBeenCalledWith(1);
	});

	it("should forward the attempt index to the retryDelay function", () => {
		expect.assertions(1);

		const retryDelay = vi.fn<(attempt: number) => number>(() => 0);
		const error = new ApiError("server error", { statusCode: 500 });

		computeRetryWaitMs(error, { attempt: 7, retryDelay });

		expect(retryDelay).toHaveBeenCalledWith(7);
	});

	it("should fall back to the retryDelay function for network errors", () => {
		expect.assertions(2);

		const retryDelay = vi.fn<(attempt: number) => number>((attempt) => 250 * (attempt + 1));
		const error = new NetworkError("Network request failed");

		expect(computeRetryWaitMs(error, { attempt: 3, retryDelay })).toBe(1000);
		expect(retryDelay).toHaveBeenCalledWith(3);
	});
});

describe(shouldRetry, () => {
	const noTransport: { readonly retryableTransportCodes: ReadonlyArray<string> } = {
		retryableTransportCodes: [],
	};

	it("should mark rate-limit errors as retryable when 429 is in the allow-list", () => {
		expect.assertions(1);

		const error = new RateLimitError("slow down", { retryAfterSeconds: 1 });

		expect(shouldRetry(error, { retryableStatuses: [429, 500], ...noTransport })).toBeTrue();
	});

	it("should not mark rate-limit errors as retryable when 429 is excluded", () => {
		expect.assertions(1);

		const error = new RateLimitError("slow down", { retryAfterSeconds: 1 });

		expect(shouldRetry(error, { retryableStatuses: [500, 502], ...noTransport })).toBeFalse();
	});

	it("should mark API errors as retryable when their status is in the allow-list", () => {
		expect.assertions(1);

		const error = new ApiError("unavailable", { statusCode: 503 });

		expect(
			shouldRetry(error, { retryableStatuses: [429, 500, 502, 503, 504], ...noTransport }),
		).toBeTrue();
	});

	it("should not mark API errors as retryable when their status is excluded", () => {
		expect.assertions(1);

		const error = new ApiError("bad request", { statusCode: 400 });

		expect(shouldRetry(error, { retryableStatuses: [429, 500], ...noTransport })).toBeFalse();
	});

	it("should mark network errors as retryable when their transport code is allowed", () => {
		expect.assertions(1);

		const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
		const error = new NetworkError("Network request failed", { cause: reset });

		expect(
			shouldRetry(error, { retryableStatuses: [], retryableTransportCodes: ["ECONNRESET"] }),
		).toBeTrue();
	});

	it("should not mark network errors as retryable when their transport code is excluded", () => {
		expect.assertions(1);

		const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
		const error = new NetworkError("Network request failed", { cause: reset });

		expect(
			shouldRetry(error, {
				retryableStatuses: [429],
				retryableTransportCodes: ["ETIMEDOUT"],
			}),
		).toBeFalse();
	});

	it("should not mark a non-network error carrying a transport code as retryable", () => {
		expect.assertions(1);

		const error = Object.assign(new Error("not a NetworkError"), { code: "ECONNRESET" });

		expect(
			shouldRetry(error, { retryableStatuses: [], retryableTransportCodes: ["ECONNRESET"] }),
		).toBeFalse();
	});

	it("should not mark a self-aborted network error as retryable", () => {
		expect.assertions(1);

		const error = new NetworkError("Network request failed", {
			cause: new DOMException("timed out", "TimeoutError"),
		});

		expect(
			shouldRetry(error, {
				retryableStatuses: [429],
				retryableTransportCodes: ["ECONNRESET", "ETIMEDOUT"],
			}),
		).toBeFalse();
	});

	it("should not mark unclassified Error instances as retryable", () => {
		expect.assertions(1);

		expect(
			shouldRetry(new Error("boom"), { retryableStatuses: [429], ...noTransport }),
		).toBeFalse();
	});

	it("should not mark non-Error values as retryable", () => {
		expect.assertions(2);

		expect(shouldRetry("oops", { retryableStatuses: [429], ...noTransport })).toBeFalse();
		expect(shouldRetry(undefined, { retryableStatuses: [429], ...noTransport })).toBeFalse();
	});
});

describe("method retry defaults", () => {
	it("should restrict create methods to retrying rate limits only", () => {
		expect.assertions(1);

		expect(CREATE_METHOD_DEFAULTS.retryableStatuses).toStrictEqual([429]);
	});

	it("should allow idempotent methods to retry rate limits and common 5xx", () => {
		expect.assertions(1);

		expect(IDEMPOTENT_METHOD_DEFAULTS.retryableStatuses).toStrictEqual([
			429, 500, 502, 503, 504,
		]);
	});

	it("should not retry any transport codes for create methods", () => {
		expect.assertions(1);

		expect(CREATE_METHOD_DEFAULTS.retryableTransportCodes).toStrictEqual([]);
	});

	it("should retry the transient transport set for idempotent methods", () => {
		expect.assertions(1);

		expect(IDEMPOTENT_METHOD_DEFAULTS.retryableTransportCodes).toStrictEqual([
			"ECONNRESET",
			"ECONNREFUSED",
			"ETIMEDOUT",
			"EPIPE",
			"ENETUNREACH",
			"EHOSTDOWN",
			"EAI_AGAIN",
			"UND_ERR_SOCKET",
		]);
	});
});

describe(mergeConfig, () => {
	describe("create methods", () => {
		it("should have method defaults override client config (create-guard)", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ retryableStatuses: [429, 500] });

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
			});

			expect(merged.retryableStatuses).toStrictEqual([429]);
		});

		it("should have requestOptions override method defaults", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ retryableStatuses: [429, 500] });

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { retryableStatuses: [429, 500, 503] },
			});

			expect(merged.retryableStatuses).toStrictEqual([429, 500, 503]);
		});

		it("should keep create transport retries empty when only client config sets them", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ retryableTransportCodes: ["ECONNRESET"] });

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
			});

			expect(merged.retryableTransportCodes).toStrictEqual([]);
		});

		it("should let requestOptions opt a create into transport-code retries", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ retryableTransportCodes: [] });

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { retryableTransportCodes: ["ECONNRESET"] },
			});

			expect(merged.retryableTransportCodes).toStrictEqual(["ECONNRESET"]);
		});

		it("should keep client apiKey when method defaults do not supply one", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ apiKey: "client-key" });

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
			});

			expect(merged.apiKey).toBe("client-key");
		});

		it("should let requestOptions override client apiKey", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ apiKey: "client-key" });

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { apiKey: "request-key" },
			});

			expect(merged.apiKey).toBe("request-key");
		});

		it("should let requestOptions override client baseUrl", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ baseUrl: "https://client.example" });

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { baseUrl: "https://request.example" },
			});

			expect(merged.baseUrl).toBe("https://request.example");
		});

		it("should let requestOptions override client timeout", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ timeout: 5_000 });

			const merged = mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "create",
				requestOptions: { timeout: 20_000 },
			});

			expect(merged.timeout).toBe(20_000);
		});

		it("should let requestOptions override client maxRetries", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ maxRetries: 3 });

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

			const clientConfig = makeRetryConfig({ retryableStatuses: [429, 500] });

			const merged = mergeConfig(clientConfig, {
				methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
				methodKind: "idempotent",
			});

			expect(merged.retryableStatuses).toStrictEqual([429, 500]);
		});

		it("should have requestOptions override client config", () => {
			expect.assertions(1);

			const clientConfig = makeRetryConfig({ retryableStatuses: [429, 500] });

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

		const clientConfig = makeRetryConfig({
			apiKey: "client-key",
			retryableStatuses: [429, 500],
		});
		const snapshot = { ...clientConfig };

		mergeConfig(clientConfig, {
			methodDefaults: CREATE_METHOD_DEFAULTS,
			methodKind: "create",
			requestOptions: { apiKey: "request-key", retryableStatuses: [503] },
		});

		expect(clientConfig).toStrictEqual(snapshot);
		expect(clientConfig.retryableStatuses).toStrictEqual([429, 500]);
	});

	it("should throw with the unknown methodKind in the error message", () => {
		expect.assertions(1);

		const clientConfig = makeRetryConfig();

		expect(() => {
			return mergeConfig(clientConfig, {
				methodDefaults: CREATE_METHOD_DEFAULTS,
				methodKind: "bogus" as MethodKind,
			});
		}).toThrowWithMessage(Error, "Unexpected methodKind: bogus");
	});
});
