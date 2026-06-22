import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";
import {
	buildFetchOptions,
	buildUrl,
	createFetchHttpClient,
	extractErrorCode,
	extractErrorMessage,
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

		// eslint-disable-next-line unicorn/no-null -- verifies JSON `null` body handling
		expect(extractErrorCode(null)).toBeUndefined();
	});

	it("should extract numeric code from legacy errors[] as a string", () => {
		expect.assertions(1);

		const body = { errors: [{ code: 22, message: "Invalid language code" }] };

		expect(extractErrorCode(body)).toBe("22");
	});

	it("should extract string code from legacy errors[]", () => {
		expect.assertions(1);

		const body = { errors: [{ code: "GAME_NOT_FOUND", message: "no" }] };

		expect(extractErrorCode(body)).toBe("GAME_NOT_FOUND");
	});

	it("should prefer top-level errorCode over legacy errors[].code when both present", () => {
		expect.assertions(1);

		const body = { errorCode: "MODERN", errors: [{ code: 99, message: "legacy" }] };

		expect(extractErrorCode(body)).toBe("MODERN");
	});

	it("should return undefined when errors is not an array", () => {
		expect.assertions(1);

		const body = { errors: "not-an-array" };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when errors[] is empty", () => {
		expect.assertions(1);

		const body = { errors: [] };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when errors[0] is not an object", () => {
		expect.assertions(1);

		const body = { errors: ["bare-string"] };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when errors[0].code is neither string nor number", () => {
		expect.assertions(1);

		const body = { errors: [{ code: { nested: true }, message: "hi" }] };

		expect(extractErrorCode(body)).toBeUndefined();
	});
});

describe(extractErrorMessage, () => {
	it("should extract a top-level message string from a modern body", () => {
		expect.assertions(1);

		const body = { errorCode: "INVALID_ARGUMENT", message: "bad request" };

		expect(extractErrorMessage(body)).toBe("bad request");
	});

	it("should extract message from legacy errors[]", () => {
		expect.assertions(1);

		const body = { errors: [{ code: 22, message: "Invalid language code" }] };

		expect(extractErrorMessage(body)).toBe("Invalid language code");
	});

	it("should prefer top-level message over legacy errors[].message when both present", () => {
		expect.assertions(1);

		const body = { errors: [{ code: 1, message: "legacy" }], message: "modern" };

		expect(extractErrorMessage(body)).toBe("modern");
	});

	it("should return undefined when body is not an object", () => {
		expect.assertions(1);

		expect(extractErrorMessage("string body")).toBeUndefined();
	});

	it("should return undefined when body is null", () => {
		expect.assertions(1);

		// eslint-disable-next-line unicorn/no-null -- verifies JSON `null` body handling
		expect(extractErrorMessage(null)).toBeUndefined();
	});

	it("should return undefined when neither shape carries a message", () => {
		expect.assertions(1);

		const body = { errors: [{ code: 1 }] };

		expect(extractErrorMessage(body)).toBeUndefined();
	});

	it("should return undefined when message is not a string", () => {
		expect.assertions(1);

		const body = { message: 42 };

		expect(extractErrorMessage(body)).toBeUndefined();
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

	it("should take the largest window from a comma-separated 429 reset header", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("22, 0")).toBe(22);
	});

	it("should take the largest window regardless of token order", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("0, 22")).toBe(22);
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

	it("should set Content-Type application/octet-stream for Uint8Array body", () => {
		expect.assertions(1);

		const body = new Uint8Array([1, 2, 3]);
		const options = buildFetchOptions(
			{ body, method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);
		const headers = new Headers(options.headers);

		expect(headers.get("content-type")).toBe("application/octet-stream");
	});

	it("should pass Uint8Array body directly without copying or serialization", () => {
		expect.assertions(1);

		const body = new Uint8Array([1, 2, 3]);
		const options = buildFetchOptions(
			{ body, method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		expect(options.body).toBe(body);
	});

	it("should apply caller-supplied headers last, overriding body-branch Content-Type", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{
				body: { name: "Game Pass" },
				headers: { "Content-Type": "application/xml" },
				method: "POST",
				url: "/test",
			},
			{ apiKey: "key", baseUrl: "https://example.com" },
		);
		const headers = new Headers(options.headers);

		expect(headers.get("content-type")).toBe("application/xml");
	});

	it("should override octet-stream default when caller supplies Content-Type for Uint8Array body", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{
				body: new Uint8Array([1, 2, 3]),
				headers: { "content-type": "application/octet-stream; charset=binary" },
				method: "POST",
				url: "/test",
			},
			{ apiKey: "key", baseUrl: "https://example.com" },
		);
		const headers = new Headers(options.headers);

		expect(headers.get("content-type")).toBe("application/octet-stream; charset=binary");
	});

	it("should add caller-supplied headers alongside x-api-key when no body-branch header is set", () => {
		expect.assertions(2);

		const options = buildFetchOptions(
			{
				headers: { "x-trace-id": "abc123" },
				method: "GET",
				url: "/test",
			},
			{ apiKey: "key", baseUrl: "https://example.com" },
		);
		const headers = new Headers(options.headers);

		expect(headers.get("x-trace-id")).toBe("abc123");
		expect(headers.get("x-api-key")).toBe("key");
	});

	it("should preserve x-api-key from config against caller-supplied override", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{
				headers: { "X-Api-Key": "caller-key" },
				method: "GET",
				url: "/test",
			},
			{ apiKey: "config-key", baseUrl: "https://example.com" },
		);
		const headers = new Headers(options.headers);

		expect(headers.get("x-api-key")).toBe("config-key");
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

	it("should parse JSON body when response Content-Type is text/plain", async () => {
		expect.assertions(3);

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify({ id: "123" }), {
				headers: { "content-type": "text/plain" },
				status: 200,
			});
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "POST", url: "/publish" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(result.success);

		expect(result.data.status).toBe(200);
		expect(result.data.body).toStrictEqual({ id: "123" });
		expect(result.data.headers["content-type"]).toBe("text/plain");
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

	it("should compose ApiError message and details from a modern errorCode body", async () => {
		expect.assertions(4);

		const body = { errorCode: "INVALID_ARGUMENT", message: "bad" };

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify(body), { status: 400 });
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
		expect(result.err.message).toBe("HTTP 400: bad (code INVALID_ARGUMENT)");
		expect(result.err.details).toStrictEqual(body);
	});

	it("should compose ApiError message and details from a legacy errors[] body", async () => {
		expect.assertions(4);

		const body = { errors: [{ code: 22, message: "Invalid language code" }] };

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify(body), { status: 400 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "POST", url: "/v1/game-icon/games/1/language-codes/en_us" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.statusCode).toBe(400);
		expect(result.err.code).toBe("22");
		expect(result.err.message).toBe("HTTP 400: Invalid language code (code 22)");
		expect(result.err.details).toStrictEqual(body);
	});

	it("should return ApiError for 300 redirect responses", async () => {
		expect.assertions(3);

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
		expect(result.err.details).toStrictEqual({});
	});

	it("should compose ApiError message from a body that carries only a top-level message", async () => {
		expect.assertions(4);

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
		expect(result.err.message).toBe("HTTP 500: internal error");
		expect(result.err.details).toStrictEqual({ message: "internal error" });
	});

	it("should compose ApiError message from a body that carries only a code", async () => {
		expect.assertions(3);

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify({ errorCode: "ALONE" }), { status: 418 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.statusCode).toBe(418);
		expect(result.err.code).toBe("ALONE");
		expect(result.err.message).toBe("HTTP 418 (code ALONE)");
	});

	it("should enrich the error when a 2xx body is not valid JSON", async () => {
		expect.assertions(4);

		async function fakeFetch(): Promise<Response> {
			return new Response("not json", {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.statusCode).toBe(200);
		expect(result.err.message).toBe(
			"Failed to parse response body (content-type: application/json)",
		);
		expect(result.err.details).toBe("not json");
		expect(result.err.cause).toBeInstanceOf(SyntaxError);
	});

	it("should label content-type unknown when a 2xx parse failure has no content-type", async () => {
		expect.assertions(1);

		async function fakeFetch(): Promise<Response> {
			return new Response(new TextEncoder().encode("not json"), { status: 200 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.message).toBe("Failed to parse response body (content-type: unknown)");
	});

	it("should truncate the raw body retained on a 2xx parse failure", async () => {
		expect.assertions(1);

		const rawBody = "x".repeat(1000);
		async function fakeFetch(): Promise<Response> {
			return new Response(rawBody, {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.details).toBe("x".repeat(500));
	});

	it("should classify a non-2xx response with a non-JSON body by its status", async () => {
		expect.assertions(4);

		async function fakeFetch(): Promise<Response> {
			return new Response("<html>502 Bad Gateway</html>", {
				headers: { "content-type": "text/html" },
				status: 502,
			});
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.statusCode).toBe(502);
		expect(result.err.message).toBe("HTTP 502");
		expect(result.err.code).toBeUndefined();
		expect(result.err.details).toBe("<html>502 Bad Gateway</html>");
	});

	it("should truncate the raw body retained on a non-JSON error response", async () => {
		expect.assertions(2);

		const rawBody = "x".repeat(1000);
		async function fakeFetch(): Promise<Response> {
			return new Response(rawBody, { status: 503 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.details).toBe("x".repeat(500));
		expect(result.err.statusCode).toBe(503);
	});

	it.for([{ status: 204 }, { status: 200 }])(
		"should return success with undefined body for empty-body $status responses",
		async ({ status }) => {
			expect.assertions(2);

			async function fakeFetch(): Promise<Response> {
				return new Response(undefined, { status });
			}

			const client = createFetchHttpClient(fakeFetch);
			const result = await client.request(
				{ method: "DELETE", url: "/test" },
				{ apiKey: "key", baseUrl: "https://example.com" },
			);

			assert(result.success);

			expect(result.data.status).toBe(status);
			expect(result.data.body).toBeUndefined();
		},
	);

	it.for([{ status: 404 }, { status: 500 }])(
		"should return ApiError preserving status for empty-body $status responses",
		async ({ status }) => {
			expect.assertions(4);

			async function fakeFetch(): Promise<Response> {
				return new Response(undefined, { status });
			}

			const client = createFetchHttpClient(fakeFetch);
			const result = await client.request(
				{ method: "DELETE", url: "/test" },
				{ apiKey: "key", baseUrl: "https://example.com" },
			);

			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err.statusCode).toBe(status);
			expect(result.err.message).toBe(`HTTP ${status}`);
			expect(result.err.code).toBeUndefined();
			expect(result.err.details).toBeUndefined();
		},
	);

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

	it("should attach the request method and resolved url to the NetworkError", async () => {
		expect.assertions(2);

		async function fakeFetch(): Promise<Response> {
			throw new TypeError("Failed to fetch");
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "POST", url: "/cloud/v2/ping" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof NetworkError);

		expect(result.err.method).toBe("POST");
		expect(result.err.url).toBe("https://example.com/cloud/v2/ping");
	});
});
