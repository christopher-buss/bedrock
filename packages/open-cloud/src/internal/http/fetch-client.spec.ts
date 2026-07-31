import { assert, describe, expect, it, vi } from "vitest";

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
import type { HttpRequest } from "./types.ts";

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

	it("should reject non-finite tokens such as Infinity", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("Infinity")).toBe(0);
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

	it("should opt uploads out of connection reuse", () => {
		expect.assertions(2);

		const binary = buildFetchOptions(
			{ body: new Uint8Array([1, 2, 3]), method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);
		const multipart = buildFetchOptions(
			{ body: new FormData(), method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		const binaryHeaders = new Headers(binary.headers);
		const multipartHeaders = new Headers(multipart.headers);

		expect(binaryHeaders.get("connection")).toBe("close");
		expect(multipartHeaders.get("connection")).toBe("close");
	});

	it("should leave non-upload requests on pooled connections", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{ body: { name: "Game Pass" }, method: "POST", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		const headers = new Headers(options.headers);

		expect(headers.get("connection")).toBeNull();
	});

	it("should keep the transport's connection directive over a request header", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{
				body: new Uint8Array([1, 2, 3]),
				headers: { connection: "keep-alive" },
				method: "POST",
				url: "/test",
			},
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		const headers = new Headers(options.headers);

		expect(headers.get("connection")).toBe("close");
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
		expect.assertions(3);

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
		// No x-ratelimit-remaining header → remaining is not reported.
		expect(result.err.remaining).toBeUndefined();
	});

	it("should capture remaining from x-ratelimit-remaining on a 429", async () => {
		expect.assertions(2);

		async function fakeFetch(): Promise<Response> {
			return new Response("rate limited", {
				headers: { "x-ratelimit-remaining": "0, 70000", "x-ratelimit-reset": "22, 0" },
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

		expect(result.err.remaining).toBe(0);
		expect(result.err.retryAfterSeconds).toBe(22);
	});

	it("should capture remaining even when the reset header is non-numeric", async () => {
		expect.assertions(2);

		async function fakeFetch(): Promise<Response> {
			return new Response("rate limited", {
				headers: { "x-ratelimit-remaining": "3", "x-ratelimit-reset": "abc" },
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

		expect(result.err.remaining).toBe(3);
		expect(result.err.retryAfterSeconds).toBe(0);
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

	it("should carry the parsed 429 body and status on details", async () => {
		expect.assertions(2);

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify({ message: "Too many requests" }), {
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

		expect(result.err.details).toStrictEqual({ message: "Too many requests" });
		expect(result.err.statusCode).toBe(429);
	});

	it("should carry a non-json 429 body as raw text on details", async () => {
		expect.assertions(1);

		async function fakeFetch(): Promise<Response> {
			return new Response("slow down", { status: 429 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof RateLimitError);

		expect(result.err.details).toBe("slow down");
	});

	it("should leave details undefined for an empty 429 body", async () => {
		expect.assertions(1);

		async function fakeFetch(): Promise<Response> {
			return new Response("", { status: 429 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof RateLimitError);

		expect(result.err.details).toBeUndefined();
	});

	it("should truncate an oversized non-json 429 body to 500 chars", async () => {
		expect.assertions(1);

		async function fakeFetch(): Promise<Response> {
			return new Response("x".repeat(600), { status: 429 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof RateLimitError);
		assert(typeof result.err.details === "string");

		expect(result.err.details).toHaveLength(500);
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
			const encoder = new TextEncoder();
			return new Response(encoder.encode("not json"), { status: 200 });
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

	it("should classify a non-2xx response with a non-JSON, non-HTML body by its status", async () => {
		expect.assertions(4);

		async function fakeFetch(): Promise<Response> {
			return new Response("upstream connect error or disconnect/reset before headers", {
				headers: { "content-type": "text/plain" },
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
		expect(result.err.details).toBe(
			"upstream connect error or disconnect/reset before headers",
		);
	});

	async function gatewayFetch(): Promise<Response> {
		return new Response(
			"<html><body><h1>400 Bad request</h1>\nYour browser sent an invalid request.\n</body></html>",
			{ headers: { "content-type": "text/html", "server": "haproxy" }, status: 400 },
		);
	}

	function fixedClock(startMs: number, deltaMs: number): () => number {
		let clock = startMs;
		return () => {
			const value = clock;
			clock += deltaMs;
			return value;
		};
	}

	it("should summarize an HTML gateway error page rather than dumping the body", async () => {
		expect.assertions(3);

		const client = createFetchHttpClient(gatewayFetch, { now: fixedClock(1000, 74_700) });
		const result = await client.request(
			{ method: "POST", url: "/universes/v1/1/places/2/versions" },
			{ apiKey: "key", baseUrl: "https://apis.roblox.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.message).toBe("HTTP 400");
		expect(result.err.gatewaySummary).toBe("400 Bad request");
		expect(result.err.details).toBeUndefined();
	});

	it("should carry the call target, elapsed time, and headers on a gateway error", async () => {
		expect.assertions(4);

		const client = createFetchHttpClient(gatewayFetch, { now: fixedClock(1000, 74_700) });
		const result = await client.request(
			{ method: "POST", url: "/universes/v1/1/places/2/versions" },
			{ apiKey: "key", baseUrl: "https://apis.roblox.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.method).toBe("POST");
		expect(result.err.url).toBe("https://apis.roblox.com/universes/v1/1/places/2/versions");
		expect(result.err.elapsedMs).toBe(74_700);
		expect(result.err.responseHeaders).toStrictEqual({ server: "haproxy" });
	});

	async function jsonErrorFetch(): Promise<Response> {
		return new Response(
			JSON.stringify({ message: "An error occurred while processing your request." }),
			{
				headers: {
					"content-type": "application/json",
					"server": "public-gateway",
					"x-roblox-edge": "c173",
				},
				status: 500,
			},
		);
	}

	it("should not summarize a JSON API error as a gateway page", async () => {
		expect.assertions(3);

		const client = createFetchHttpClient(jsonErrorFetch, { now: fixedClock(0, 40_200) });
		const result = await client.request(
			{ method: "POST", url: "/universes/v1/1/places/2/versions" },
			{ apiKey: "key", baseUrl: "https://apis.roblox.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.gatewaySummary).toBeUndefined();
		expect(result.err.details).toStrictEqual({
			message: "An error occurred while processing your request.",
		});
		expect(result.err.message).toBe(
			"HTTP 500: An error occurred while processing your request.",
		);
	});

	it("should attach the call target, elapsed time, and headers to a JSON API error", async () => {
		expect.assertions(4);

		const client = createFetchHttpClient(jsonErrorFetch, { now: fixedClock(0, 40_200) });
		const result = await client.request(
			{ method: "POST", url: "/universes/v1/1/places/2/versions" },
			{ apiKey: "key", baseUrl: "https://apis.roblox.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.method).toBe("POST");
		expect(result.err.url).toBe("https://apis.roblox.com/universes/v1/1/places/2/versions");
		expect(result.err.elapsedMs).toBe(40_200);
		expect(result.err.responseHeaders).toStrictEqual({
			"server": "public-gateway",
			"x-roblox-edge": "c173",
		});
	});

	it("should measure elapsed time with the default clock when none is injected", async () => {
		expect.assertions(2);

		async function fakeFetch(): Promise<Response> {
			return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);
		assert(result.err.elapsedMs !== undefined);

		expect(result.err.elapsedMs).toBeTypeOf("number");
		expect(result.err.elapsedMs).toBeGreaterThanOrEqual(0);
	});

	it("should clamp a backwards-moving clock to a non-negative elapsed time", async () => {
		expect.assertions(1);

		const client = createFetchHttpClient(jsonErrorFetch, { now: fixedClock(5000, -1000) });
		const result = await client.request(
			{ method: "POST", url: "/universes/v1/1/places/2/versions" },
			{ apiKey: "key", baseUrl: "https://apis.roblox.com" },
		);

		assert(!result.success);
		assert(result.err instanceof ApiError);

		expect(result.err.elapsedMs).toBe(0);
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

	it("should return NetworkError when reading the response body fails", async () => {
		expect.assertions(3);

		async function fakeFetch(): Promise<Response> {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.error(new Error("body stream aborted"));
				},
			});
			return new Response(stream, { status: 500 });
		}

		const client = createFetchHttpClient(fakeFetch);
		const result = await client.request(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		assert(!result.success);
		assert(result.err instanceof NetworkError);

		expect(result.err.method).toBe("GET");
		expect(result.err.url).toBe("https://example.com/test");
		expect(result.err.cause).toBeInstanceOf(Error);
	});

	describe("http/1.1 dispatcher", () => {
		const config = { apiKey: "key", baseUrl: "https://example.com" };
		const uploadRequest: HttpRequest = {
			body: new Uint8Array([1]),
			method: "POST",
			url: "/upload",
		};

		/**
		 * A fetch double that records the `RequestInit` of every call.
		 *
		 * @returns The fake fetch and the inits it was called with.
		 */
		function recordingFetch(): {
			calls: Array<RequestInit>;
			fetchFunc: (url: string, init: RequestInit) => Promise<Response>;
		} {
			const calls: Array<RequestInit> = [];
			return {
				calls,
				fetchFunc: async (_url, init) => {
					calls.push(init);
					return new Response("{}", { status: 200 });
				},
			};
		}

		/**
		 * Reads the dispatcher off a recorded call, asserting the call happened
		 * so a request that never fired cannot pass as an absent dispatcher.
		 *
		 * @param calls - The inits recorded by {@link recordingFetch}.
		 * @param index - Which call to read.
		 * @returns The dispatcher that call carried, if any.
		 */
		function dispatcherOf(calls: Array<RequestInit>, index: number): unknown {
			const call = calls[index];
			assert(call !== undefined, `expected a fetch call at index ${index}`);
			return Reflect.get(call, "dispatcher");
		}

		it("should resolve the dispatcher once and reuse it across uploads", async () => {
			expect.assertions(2);

			// A distinct instance per call, so a second resolution would show up
			// as a different dispatcher on the second request.
			const createDispatcher = vi
				.fn<() => object | undefined>()
				.mockReturnValueOnce({ marker: 1 })
				.mockReturnValue({ marker: 2 });
			const { calls, fetchFunc } = recordingFetch();

			const client = createFetchHttpClient(fetchFunc, { createDispatcher });
			await client.request(uploadRequest, config);
			await client.request(uploadRequest, config);

			expect(dispatcherOf(calls, 0)).toStrictEqual({ marker: 1 });
			expect(dispatcherOf(calls, 1)).toBe(dispatcherOf(calls, 0));
		});

		it("should not look for a dispatcher until an upload needs one", async () => {
			expect.assertions(1);

			const createDispatcher = vi.fn<() => object | undefined>(() => ({ marker: "http1" }));
			const { fetchFunc } = recordingFetch();

			const client = createFetchHttpClient(fetchFunc, { createDispatcher });
			await client.request({ method: "GET", url: "/test" }, config);

			expect(createDispatcher).not.toHaveBeenCalled();
		});

		it("should retry resolution while the runtime publishes no dispatcher", async () => {
			expect.assertions(2);

			const dispatcher = { marker: "http1" };
			const createDispatcher = vi
				.fn<() => object | undefined>()
				.mockReturnValueOnce(undefined)
				.mockReturnValue(dispatcher);
			const { calls, fetchFunc } = recordingFetch();

			const client = createFetchHttpClient(fetchFunc, { createDispatcher });
			await client.request(uploadRequest, config);
			await client.request(uploadRequest, config);

			expect(dispatcherOf(calls, 0)).toBeUndefined();
			expect(dispatcherOf(calls, 1)).toBe(dispatcher);
		});
	});
});
