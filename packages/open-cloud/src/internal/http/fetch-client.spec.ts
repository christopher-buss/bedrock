import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import {
	buildFetchOptions,
	buildUrl,
	createFetchHttpClient,
	extractErrorCode,
	headersToRecord,
	parseRetryAfterSeconds,
} from "./fetch-client.ts";

describe(headersToRecord, () => {
	it("should convert Headers to a lowercased record", () => {
		expect.assertions(1);

		const headers = new Headers({
			"Content-Type": "application/json",
			"X-Request-Id": "abc123",
		});

		expect(headersToRecord(headers)).toStrictEqual({
			"content-type": "application/json",
			"x-request-id": "abc123",
		});
	});

	it("should return empty record for empty headers", () => {
		expect.assertions(1);

		const headers = new Headers();

		expect(headersToRecord(headers)).toStrictEqual({});
	});
});

describe(extractErrorCode, () => {
	it("should extract errorCode string from body object", () => {
		expect.assertions(1);

		const body = { errorCode: "INVALID_ARGUMENT", message: "bad request" };

		expect(extractErrorCode(body)).toBe("INVALID_ARGUMENT");
	});

	it("should return undefined when body has no errorCode", () => {
		expect.assertions(1);

		const body = { message: "not found" };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when body is not an object", () => {
		expect.assertions(1);

		expect(extractErrorCode("string body")).toBeUndefined();
	});

	it("should return undefined when errorCode is not a string", () => {
		expect.assertions(1);

		const body = { errorCode: 42 };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when body is null", () => {
		expect.assertions(1);

		expect(extractErrorCode(null)).toBeUndefined();
	});
});

describe(parseRetryAfterSeconds, () => {
	it("should parse a valid numeric string", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("5")).toBe(5);
	});

	it("should return 0 for undefined header value", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds(undefined)).toBe(0);
	});

	it("should return 0 for non-numeric string", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("abc")).toBe(0);
	});

	it("should return 0 for negative values", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("-3")).toBe(0);
	});
});

describe(buildUrl, () => {
	it("should join baseUrl and request url", () => {
		expect.assertions(1);

		const result = buildUrl(
			{ method: "GET", url: "/game-passes/v1/universes/123" },
			{ apiKey: "key", baseUrl: "https://apis.roblox.com" },
		);

		expect(result).toBe("https://apis.roblox.com/game-passes/v1/universes/123");
	});

	it("should handle baseUrl with trailing slash", () => {
		expect.assertions(1);

		const result = buildUrl(
			{ method: "GET", url: "/game-passes/v1/universes/123" },
			{ apiKey: "key", baseUrl: "https://apis.roblox.com/" },
		);

		expect(result).toBe("https://apis.roblox.com/game-passes/v1/universes/123");
	});
});

describe(buildFetchOptions, () => {
	it("should set x-api-key header from config", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{ method: "GET", url: "/test" },
			{ apiKey: "test-key", baseUrl: "https://example.com" },
		);
		const headers = new Headers(options.headers);

		expect(headers.get("x-api-key")).toBe("test-key");
	});

	it("should set method from request", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{ method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		expect(options.method).toBe("POST");
	});

	it("should set Content-Type and stringify body for object bodies", () => {
		expect.assertions(2);

		const body = { name: "Game Pass" };
		const options = buildFetchOptions(
			{ body, method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);
		const headers = new Headers(options.headers);

		expect(headers.get("content-type")).toBe("application/json");
		expect(options.body).toBe(JSON.stringify(body));
	});

	it("should omit Content-Type for FormData body", () => {
		expect.assertions(1);

		const body = new FormData();
		const options = buildFetchOptions(
			{ body, method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);
		const headers = new Headers(options.headers);

		expect(headers.get("content-type")).toBeNull();
	});

	it("should pass FormData body directly without serialization", () => {
		expect.assertions(1);

		const body = new FormData();
		body.append("file", "data");
		const options = buildFetchOptions(
			{ body, method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		expect(options.body).toBe(body);
	});

	it("should set AbortSignal.timeout when timeout configured", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com", timeout: 5000 },
		);

		expect(options.signal).toBeInstanceOf(AbortSignal);
	});

	it("should not set signal when timeout is undefined", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		expect(options.signal).toBeUndefined();
	});

	it("should omit body and Content-Type when request body is undefined", () => {
		expect.assertions(2);

		const options = buildFetchOptions(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);
		const headers = new Headers(options.headers);

		expect(options.body).toBeUndefined();
		expect(headers.get("content-type")).toBeNull();
	});
});

describe(createFetchHttpClient, () => {
	it("should return success Result with parsed body for 200", async () => {
		expect.assertions(3);

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify({ id: "123" }), {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(result.success);

		expect(result.data.status).toBe(200);
		expect(result.data.body).toStrictEqual({ id: "123" });
		expect(result.data.headers["content-type"]).toBe("application/json");
	});

	it("should return RateLimitError for 429 with x-ratelimit-reset header", async () => {
		expect.assertions(2);

		async function fakeFetch(): Promise<Response> {
			return new Response("rate limited", {
				headers: { "x-ratelimit-reset": "5" },
				status: 429,
			});
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof RateLimitError);

		expect(result.err.retryAfterSeconds).toBe(5);
		expect(result.err.message).toBe("Rate limited");
	});

	it("should return RateLimitError with retryAfterSeconds 0 when header missing", async () => {
		expect.assertions(1);

		async function fakeFetch(): Promise<Response> {
			return new Response("rate limited", { status: 429 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof RateLimitError);

		expect(result.err.retryAfterSeconds).toBe(0);
	});

	it("should return ApiError for 400 with errorCode in body", async () => {
		expect.assertions(3);

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify({ errorCode: "INVALID_ARGUMENT", message: "bad" }), {
				status: 400,
			});
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.statusCode).toBe(400);
		expect(result.err.code).toBe("INVALID_ARGUMENT");
		expect(result.err.message).toBe("HTTP 400");
	});

	it("should return ApiError for 300 redirect responses", async () => {
		expect.assertions(2);

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify({}), { status: 300 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.statusCode).toBe(300);
		expect(result.err.message).toBe("HTTP 300");
	});

	it("should return ApiError for 500 without errorCode", async () => {
		expect.assertions(2);

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify({ message: "internal error" }), { status: 500 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.statusCode).toBe(500);
		expect(result.err.code).toBeUndefined();
	});

	it("should return ApiError when response body is not valid JSON", async () => {
		expect.assertions(2);

		async function fakeFetch(): Promise<Response> {
			return new Response("not json", { status: 200 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.message).toBe("Failed to parse response body");
		expect(result.err.statusCode).toBe(200);
	});

	it("should return NetworkError when fetch throws TypeError", async () => {
		expect.assertions(2);

		const cause = new TypeError("Failed to fetch");
		async function fakeFetch(): Promise<Response> {
			throw cause;
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof NetworkError);

		expect(result.err.cause).toBe(cause);
		expect(result.err.message).toBe("Network request failed");
	});
});
