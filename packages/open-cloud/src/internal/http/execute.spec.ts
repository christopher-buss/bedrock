import { CodedError } from "#tests/helpers/coded-error";
import { createFakeSend } from "#tests/helpers/fake-send";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { makeRetryConfig } from "#tests/helpers/retry-config";
import { assert, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import { executeWithRetry } from "./execute.ts";
import { defaultRetryDelay, IDEMPOTENT_METHOD_DEFAULTS } from "./retry.ts";
import type { HttpRequest, HttpResponse, OpenCloudHooks } from "./types.ts";

function okResponse(body: unknown = {}): HttpResponse {
	return { body, headers: {}, status: 200 };
}

const request: HttpRequest = { method: "GET", url: "/v1/ping" };

describe(executeWithRetry, () => {
	it("should return the first response when the initial attempt succeeds", async () => {
		expect.assertions(4);

		const onRequest = vi.fn<(request: HttpRequest) => void>();
		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const onRateLimit = vi.fn<(waitMs: number) => void>();
		const hooks: OpenCloudHooks = { onRateLimit, onRequest, onRetry };
		const fakeSend = createFakeSend({
			responses: [{ data: okResponse({ id: "1" }), success: true }],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig(),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(result.success);

		expect(result.data.body).toStrictEqual({ id: "1" });
		expect(fakeSend.requests).toHaveLength(1);
		expect(onRetry).not.toHaveBeenCalled();
		expect(onRateLimit).not.toHaveBeenCalled();
	});

	it("should retry a 429 rate-limit response until success", async () => {
		expect.assertions(5);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const onRateLimit = vi.fn<(waitMs: number) => void>();
		const hooks: OpenCloudHooks = { onRateLimit, onRetry };
		const rateLimitError = new RateLimitError("slow down", { retryAfterSeconds: 1 });
		const fakeSend = createFakeSend({
			responses: [
				{ err: rateLimitError, success: false },
				{ data: okResponse({ id: "ok" }), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig(),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(result.success);

		expect(result.data.body).toStrictEqual({ id: "ok" });
		expect(fakeSend.requests).toHaveLength(2);
		expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, rateLimitError);
		expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(1000);
		expect(fakeSleep.waits).toStrictEqual([1000]);
	});

	it("should retry a retryable 5xx response for idempotent methods", async () => {
		expect.assertions(4);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const hooks: OpenCloudHooks = { onRetry };
		const serverError = new ApiError("unavailable", { statusCode: 503 });
		const fakeSend = createFakeSend({
			responses: [
				{ err: serverError, success: false },
				{ data: okResponse({ id: "ok" }), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig({
				retryableStatuses: IDEMPOTENT_METHOD_DEFAULTS.retryableStatuses,
			}),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(result.success);

		expect(result.data.body).toStrictEqual({ id: "ok" });
		expect(fakeSend.requests).toHaveLength(2);
		expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, serverError);
		expect(fakeSleep.waits).toHaveLength(1);
	});

	it("should retry a transient transport error for idempotent methods", async () => {
		expect.assertions(3);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const hooks: OpenCloudHooks = { onRetry };
		const reset = new CodedError("read ECONNRESET", "ECONNRESET");
		const networkError = new NetworkError("Network request failed", { cause: reset });
		const fakeSend = createFakeSend({
			responses: [
				{ err: networkError, success: false },
				{ data: okResponse({ id: "ok" }), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig({
				retryableTransportCodes: IDEMPOTENT_METHOD_DEFAULTS.retryableTransportCodes,
			}),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(result.success);

		expect(result.data.body).toStrictEqual({ id: "ok" });
		expect(fakeSend.requests).toHaveLength(2);
		expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, networkError);
	});

	it("should retry a self-aborted request timeout for idempotent methods", async () => {
		expect.assertions(3);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const hooks: OpenCloudHooks = { onRetry };
		const networkError = new NetworkError("Network request failed", {
			cause: new DOMException("The operation timed out.", "TimeoutError"),
		});
		const fakeSend = createFakeSend({
			responses: [
				{ err: networkError, success: false },
				{ data: okResponse({ id: "ok" }), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig({
				retryableTransportCodes: IDEMPOTENT_METHOD_DEFAULTS.retryableTransportCodes,
			}),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(result.success);

		expect(result.data.body).toStrictEqual({ id: "ok" });
		expect(fakeSend.requests).toHaveLength(2);
		expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, networkError);
	});

	it("should not retry a transient transport error when no transport code is allowed", async () => {
		expect.assertions(3);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const hooks: OpenCloudHooks = { onRetry };
		const reset = new CodedError("read ECONNRESET", "ECONNRESET");
		const networkError = new NetworkError("Network request failed", { cause: reset });
		const fakeSend = createFakeSend({
			responses: [{ err: networkError, success: false }],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig({ retryableTransportCodes: [] }),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(!result.success);

		expect(result.err).toBe(networkError);
		expect(fakeSend.requests).toHaveLength(1);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("should not retry a non-retryable 4xx response", async () => {
		expect.assertions(4);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const onRateLimit = vi.fn<(waitMs: number) => void>();
		const hooks: OpenCloudHooks = { onRateLimit, onRetry };
		const badRequest = new ApiError("bad request", { statusCode: 400 });
		const fakeSend = createFakeSend({
			responses: [{ err: badRequest, success: false }],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig(),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(!result.success);

		expect(result.err).toBe(badRequest);
		expect(fakeSend.requests).toHaveLength(1);
		expect(onRetry).not.toHaveBeenCalled();
		expect(onRateLimit).not.toHaveBeenCalled();
	});

	it("should stop after maxRetries attempts and return the last error", async () => {
		expect.assertions(4);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const hooks: OpenCloudHooks = { onRetry };
		const lastError = new RateLimitError("still limited", { retryAfterSeconds: 1 });
		const fakeSend = createFakeSend({
			responses: [
				{ err: new RateLimitError("one", { retryAfterSeconds: 1 }), success: false },
				{ err: new RateLimitError("two", { retryAfterSeconds: 1 }), success: false },
				{ err: lastError, success: false },
			],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig({ maxRetries: 2 }),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(!result.success);

		expect(result.err).toBe(lastError);
		expect(fakeSend.requests).toHaveLength(3);
		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(fakeSleep.waits).toHaveLength(2);
	});

	it("should succeed on a later retry attempt", async () => {
		expect.assertions(4);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const hooks: OpenCloudHooks = { onRetry };
		const fakeSend = createFakeSend({
			responses: [
				{ err: new RateLimitError("1", { retryAfterSeconds: 1 }), success: false },
				{ err: new RateLimitError("2", { retryAfterSeconds: 1 }), success: false },
				{ data: okResponse({ id: "ok" }), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig(),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(result.success);

		expect(result.data.body).toStrictEqual({ id: "ok" });
		expect(fakeSend.requests).toHaveLength(3);
		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(fakeSleep.waits).toHaveLength(2);
	});

	it("should fire onRequest before every attempt", async () => {
		expect.assertions(2);

		const onRequest = vi.fn<(request: HttpRequest) => void>();
		const hooks: OpenCloudHooks = { onRequest };
		const fakeSend = createFakeSend({
			responses: [
				{ err: new RateLimitError("1", { retryAfterSeconds: 1 }), success: false },
				{ err: new RateLimitError("2", { retryAfterSeconds: 1 }), success: false },
				{ data: okResponse(), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		await executeWithRetry(request, {
			config: makeRetryConfig(),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		expect(onRequest).toHaveBeenCalledTimes(3);
		expect(onRequest.mock.calls.every((call) => call[0] === request)).toBeTrue();
	});

	it("should fire onRetry with the 1-indexed attempt number", async () => {
		expect.assertions(3);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const hooks: OpenCloudHooks = { onRetry };
		const firstError = new RateLimitError("1", { retryAfterSeconds: 1 });
		const secondError = new RateLimitError("2", { retryAfterSeconds: 1 });
		const fakeSend = createFakeSend({
			responses: [
				{ err: firstError, success: false },
				{ err: secondError, success: false },
				{ data: okResponse(), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		await executeWithRetry(request, {
			config: makeRetryConfig(),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenNthCalledWith(1, 1, firstError);
		expect(onRetry).toHaveBeenNthCalledWith(2, 2, secondError);
	});

	it("should fire onRateLimit with the same waitMs passed to sleep", async () => {
		expect.assertions(2);

		const onRateLimit = vi.fn<(waitMs: number) => void>();
		const hooks: OpenCloudHooks = { onRateLimit };
		const fakeSend = createFakeSend({
			responses: [
				{ err: new RateLimitError("1", { retryAfterSeconds: 2 }), success: false },
				{ err: new RateLimitError("2", { retryAfterSeconds: 5 }), success: false },
				{ data: okResponse(), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		await executeWithRetry(request, {
			config: makeRetryConfig(),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		expect(onRateLimit.mock.calls.map(([waitMs]) => waitMs)).toStrictEqual([2000, 5000]);
		expect(fakeSleep.waits).toStrictEqual([2000, 5000]);
	});

	it("should honour adaptive backoff from retry-after over the fallback retryDelay", async () => {
		expect.assertions(2);

		const retryDelay = vi.fn<(attempt: number) => number>(() => 99_999);
		const fakeSend = createFakeSend({
			responses: [
				{ err: new RateLimitError("slow", { retryAfterSeconds: 3 }), success: false },
				{ data: okResponse(), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		await executeWithRetry(request, {
			config: makeRetryConfig({ retryDelay }),
			hooks: {},
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		expect(fakeSleep.waits).toStrictEqual([3000]);
		expect(retryDelay).not.toHaveBeenCalled();
	});

	it("should use exponential backoff for 5xx errors with no retry-after hint", async () => {
		expect.assertions(1);

		const fakeSend = createFakeSend({
			responses: [
				{ err: new ApiError("1", { statusCode: 500 }), success: false },
				{ err: new ApiError("2", { statusCode: 500 }), success: false },
				{ data: okResponse(), success: true },
			],
		});
		const fakeSleep = createFakeSleep();

		await executeWithRetry(request, {
			config: makeRetryConfig({
				retryableStatuses: [500],
				retryDelay: defaultRetryDelay,
			}),
			hooks: {},
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		expect(fakeSleep.waits).toStrictEqual([1000, 2000]);
	});

	it("should not retry when retryableStatuses is empty even for a 429", async () => {
		expect.assertions(3);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const hooks: OpenCloudHooks = { onRetry };
		const rateLimitError = new RateLimitError("no retries", { retryAfterSeconds: 1 });
		const fakeSend = createFakeSend({
			responses: [{ err: rateLimitError, success: false }],
		});
		const fakeSleep = createFakeSleep();

		const result = await executeWithRetry(request, {
			config: makeRetryConfig({ retryableStatuses: [] }),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		assert(!result.success);

		expect(result.err).toBe(rateLimitError);
		expect(fakeSend.requests).toHaveLength(1);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("should not fire onRetry on the final exhausted attempt", async () => {
		expect.assertions(1);

		const onRetry = vi.fn<(attempt: number, error: Error) => void>();
		const hooks: OpenCloudHooks = { onRetry };
		const firstError = new RateLimitError("1", { retryAfterSeconds: 1 });
		const finalError = new RateLimitError("2", { retryAfterSeconds: 1 });
		const fakeSend = createFakeSend({
			responses: [
				{ err: firstError, success: false },
				{ err: finalError, success: false },
			],
		});
		const fakeSleep = createFakeSleep();

		await executeWithRetry(request, {
			config: makeRetryConfig({ maxRetries: 1 }),
			hooks,
			send: fakeSend.send,
			sleep: fakeSleep,
		});

		expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, firstError);
	});
});
