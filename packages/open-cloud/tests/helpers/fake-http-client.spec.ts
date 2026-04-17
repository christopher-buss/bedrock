import { ApiError } from "#src/errors/api-error";
import { OpenCloudError } from "#src/errors/base";
import { NetworkError } from "#src/errors/network-error";
import { RateLimitError } from "#src/errors/rate-limit";
import type { HttpRequest, RequestConfig } from "#src/internal/http/types";
import { assert, describe, expect, it } from "vitest";

import { createFakeHttpClient, FakeHttpClientError } from "./fake-http-client.ts";

const getRequest: HttpRequest = { method: "GET", url: "/v1/ping" };
const postRequest: HttpRequest = {
	body: { name: "pass" },
	method: "POST",
	url: "/v1/create",
};
const config: RequestConfig = { apiKey: "test", baseUrl: "https://apis.roblox.test" };
const overrideConfig: RequestConfig = {
	apiKey: "override",
	baseUrl: "https://override.test",
};

describe(createFakeHttpClient, () => {
	it("should record both request and config on each call", async () => {
		expect.assertions(1);

		const fake = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockResponse({ status: 201 });

		await fake.request(getRequest, config);
		await fake.request(postRequest, overrideConfig);

		expect(fake.requests).toStrictEqual([
			{ config, request: getRequest },
			{ config: overrideConfig, request: postRequest },
		]);
	});

	it("should default mockResponse body and headers when omitted", async () => {
		expect.assertions(1);

		const fake = createFakeHttpClient().mockResponse({ status: 204 });

		const result = await fake.request(getRequest, config);

		expect(result).toStrictEqual({
			data: { body: {}, headers: {}, status: 204 },
			success: true,
		});
	});

	it("should replay mockResponse with provided body and headers", async () => {
		expect.assertions(1);

		const fake = createFakeHttpClient().mockResponse({
			body: { id: "abc" },
			headers: { "x-custom": "1" },
			status: 200,
		});

		const result = await fake.request(getRequest, config);

		expect(result).toStrictEqual({
			data: { body: { id: "abc" }, headers: { "x-custom": "1" }, status: 200 },
			success: true,
		});
	});

	it("should replay mockError with the exact error instance", async () => {
		expect.assertions(1);

		const error = new OpenCloudError("boom");
		const fake = createFakeHttpClient().mockError(error);

		const result = await fake.request(getRequest, config);

		assert(!result.success);

		expect(result.err).toBe(error);
	});

	it("should replay mockRateLimit as RateLimitError with retryAfterSeconds", async () => {
		expect.assertions(2);

		const fake = createFakeHttpClient()
			.mockRateLimit({ retryAfterSeconds: 2 })
			.mockRateLimit({ message: "slow down", retryAfterSeconds: 5 });

		const defaultResult = await fake.request(getRequest, config);
		const customResult = await fake.request(getRequest, config);

		assert(!defaultResult.success);
		assert(!customResult.success);

		expect(defaultResult.err).toBeInstanceOf(RateLimitError);
		expect(customResult.err).toStrictEqual(
			new RateLimitError("slow down", { retryAfterSeconds: 5 }),
		);
	});

	it("should replay mockApiError as ApiError with statusCode and optional code", async () => {
		expect.assertions(3);

		const fake = createFakeHttpClient()
			.mockApiError({ statusCode: 500 })
			.mockApiError({ code: "BAD_INPUT", message: "bad input", statusCode: 400 });

		const defaultResult = await fake.request(getRequest, config);
		const detailedResult = await fake.request(getRequest, config);

		assert(!defaultResult.success);
		assert(!detailedResult.success);
		assert(detailedResult.err instanceof ApiError);

		expect(defaultResult.err).toBeInstanceOf(ApiError);
		expect(detailedResult.err).toStrictEqual(
			new ApiError("bad input", { code: "BAD_INPUT", statusCode: 400 }),
		);
		expect(detailedResult.err.code).toBe("BAD_INPUT");
	});

	it("should replay mockNetworkError as NetworkError preserving cause when provided", async () => {
		expect.assertions(3);

		const cause = new Error("ECONNREFUSED");
		const fake = createFakeHttpClient()
			.mockNetworkError()
			.mockNetworkError({ cause, message: "dial failed" });

		const defaultResult = await fake.request(getRequest, config);
		const detailedResult = await fake.request(getRequest, config);

		assert(!defaultResult.success);
		assert(!detailedResult.success);

		expect(defaultResult.err).toBeInstanceOf(NetworkError);
		expect(detailedResult.err.message).toBe("dial failed");
		expect(detailedResult.err.cause).toBe(cause);
	});

	it("should consume mocks FIFO across mixed error types", async () => {
		expect.assertions(3);

		const fake = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockApiError({ statusCode: 500 })
			.mockRateLimit({ retryAfterSeconds: 1 })
			.mockNetworkError();

		const first = await fake.request(getRequest, config);
		const second = await fake.request(getRequest, config);
		const third = await fake.request(getRequest, config);
		const fourth = await fake.request(getRequest, config);

		assert(first.success);
		assert(!second.success && !third.success && !fourth.success);

		expect(second.err).toBeInstanceOf(ApiError);
		expect(third.err).toBeInstanceOf(RateLimitError);
		expect(fourth.err).toBeInstanceOf(NetworkError);
	});

	it("should reflect queue depth in pendingMocks", async () => {
		expect.assertions(3);

		const fake = createFakeHttpClient();

		expect(fake.pendingMocks).toBe(0);

		fake.mockResponse({ status: 200 }).mockApiError({ statusCode: 500 });

		expect(fake.pendingMocks).toBe(2);

		await fake.request(getRequest, config);

		expect(fake.pendingMocks).toBe(1);
	});

	it("should throw FakeHttpClientError naming method, url, and consumed count when queue is empty", async () => {
		expect.assertions(2);

		const fake = createFakeHttpClient().mockResponse({ status: 200 });
		await fake.request(getRequest, config);

		await expect(fake.request(postRequest, config)).rejects.toThrow(FakeHttpClientError);
		await expect(fake.request(postRequest, config)).rejects.toThrow(
			"FakeHttpClient: no mock queued for POST /v1/create (consumed 1, pending 0)",
		);
	});

	it("should expose FakeHttpClientError as an Error subclass", () => {
		expect.assertions(2);

		const error = new FakeHttpClientError("boom");

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("FakeHttpClientError");
	});
});
