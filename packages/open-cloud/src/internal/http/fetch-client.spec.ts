import { describe, expect, it } from "vitest";

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

	it("should omit body when request body is undefined", () => {
		expect.assertions(1);

		const options = buildFetchOptions(
			{ method: "GET", url: "/test" },
			{ apiKey: "key", baseUrl: "https://example.com" },
		);

		expect(options.body).toBeUndefined();
	});
});

describe(createFetchHttpClient, () => {
	it("should return success Result with parsed body for 200", async () => {
		expect.assertions(4);

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

		expect(result.success).toBe(true);

		const response = (
			result as {
				data: { body: unknown; headers: Record<string, string>; status: number };
				success: true;
			}
		).data;

		expect(response.status).toBe(200);
		expect(response.body).toStrictEqual({ id: "123" });
		expect(response.headers["content-type"]).toBe("application/json");
	});
});
