import { createFakeClock } from "#tests/helpers/fake-clock";
import {
	createFakeHttpClient,
	type FakeHttpClient,
} from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { assert, describe, expect, it, vi } from "vitest";

import type { HttpRequest, OpenCloudHooks } from "../client/types.ts";
import { ApiError } from "../errors/api-error.ts";
import { PermissionError } from "../errors/permission-error.ts";
import { ValidationError } from "../errors/validation.ts";
import type { Result } from "../types.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "./http/retry.ts";
import { okRequest, ResourceClient, type ResourceMethodSpec } from "./resource-client.ts";

interface TestParameters {
	readonly id: string;
}

interface TestResult {
	readonly ok: true;
}

function parseTestResponse(response: { readonly status: number }): Result<TestResult, ApiError> {
	if (response.status === 200) {
		return { data: { ok: true }, success: true };
	}

	return {
		err: new ApiError("test parser rejection", { statusCode: response.status }),
		success: false,
	};
}

function buildTestPostRequest(parameters: TestParameters): HttpRequest {
	return { body: { id: parameters.id }, method: "POST", url: "/test" };
}

function buildTestUploadRequest(): HttpRequest {
	return { body: new Uint8Array([1, 2, 3]), method: "POST", url: "/upload" };
}

const TEST_GET_SPEC: ResourceMethodSpec<TestParameters, TestResult> = {
	buildRequest: (parameters) => okRequest({ method: "GET", url: `/test/${parameters.id}` }),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: Object.freeze({ maxPerSecond: 10, operationKey: "test.get" }),
	parse: parseTestResponse,
};

const TEST_CREATE_SPEC: ResourceMethodSpec<TestParameters, TestResult> = {
	buildRequest: (parameters) => okRequest(buildTestPostRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: Object.freeze({ maxPerSecond: 5, operationKey: "test.create" }),
	parse: parseTestResponse,
};

const TEST_UPLOAD_SPEC: ResourceMethodSpec<TestParameters, TestResult> = {
	buildRequest: () => okRequest(buildTestUploadRequest()),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: Object.freeze({ maxPerSecond: 5, operationKey: "test.upload" }),
	parse: parseTestResponse,
};

function mockManyOk(fake: FakeHttpClient, count: number): FakeHttpClient {
	for (let index = 0; index < count; index++) {
		fake.mockResponse({ status: 200 });
	}

	return fake;
}

describe(ResourceClient, () => {
	describe("builder short-circuit", () => {
		it("should return the builder error without acquiring the queue, hitting HTTP, or sleeping", async () => {
			expect.assertions(4);

			const builderError = new ValidationError("rejected by builder", { code: "empty_body" });
			const httpClient = createFakeHttpClient({ schemaValidation: "off" });
			const sleep = createFakeSleep();
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const client = new ResourceClient({
				apiKey: "test-key",
				hooks: { onRequest },
				httpClient,
				sleep,
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: {
					buildRequest: () => ({ err: builderError, success: false }),
					methodDefaults: CREATE_METHOD_DEFAULTS,
					methodKind: "create",
					operationLimit: Object.freeze({
						maxPerSecond: 1,
						operationKey: "test.short-circuit",
					}),
					parse: parseTestResponse,
				},
			});

			assert(!result.success);

			expect(result.err).toBe(builderError);
			expect(httpClient.requests).toHaveLength(0);
			expect(sleep.waits).toStrictEqual([]);
			expect(onRequest).not.toHaveBeenCalled();
		});
	});

	describe("config semantics", () => {
		it("should apply per-request overrides over the client config for apiKey, baseUrl, and timeout", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				status: 200,
			});
			const client = new ResourceClient({
				apiKey: "client-key",
				baseUrl: "https://apis.roblox.com",
				httpClient,
				sleep: createFakeSleep(),
				timeout: 30_000,
			});

			await client.execute({
				options: {
					apiKey: "override-key",
					baseUrl: "https://override.example",
					timeout: 1000,
				},
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			expect(httpClient.requests[0]?.config).toStrictEqual({
				apiKey: "override-key",
				baseUrl: "https://override.example",
				timeout: 1000,
			});
		});

		it("should leave the client config untouched after a call that used overrides", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockResponse({ status: 200 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "client-key",
				baseUrl: "https://apis.roblox.com",
				httpClient,
				sleep: createFakeSleep(),
				timeout: 5000,
			});

			await client.execute({
				options: { apiKey: "override-key", timeout: 99 },
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});
			await client.execute({ parameters: { id: "2" }, spec: TEST_GET_SPEC });

			expect(httpClient.requests[1]?.config).toStrictEqual({
				apiKey: "client-key",
				baseUrl: "https://apis.roblox.com",
				timeout: 5000,
			});
		});

		it("should replace the retryableStatuses array when the field is overridden per request", async () => {
			expect.assertions(1);

			// Client default retries 5xx; the override narrows to 429 only.
			// A 500 then 200 sequence proves the 500 isn't retried when the
			// override replaces (not extends) the array.
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockApiError({ statusCode: 500 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				options: { retryableStatuses: [429] },
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			assert(!result.success);

			expect(httpClient.requests).toHaveLength(1);
		});

		it("should apply create-method defaults over client config for create-kind specs", async () => {
			expect.assertions(1);

			// Client-level config loosens retries to include 500. Under a
			// create-kind spec the method defaults (`[429]`) take precedence
			// so the 500 is not retried: create-method safety cannot be
			// relaxed silently from the client level.
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockApiError({ statusCode: 500 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				retryableStatuses: [500],
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: TEST_CREATE_SPEC,
			});

			assert(!result.success);

			expect(httpClient.requests).toHaveLength(1);
		});
	});

	describe("upload timeout policy", () => {
		it("should drop the default timeout for an upload request with no per-request timeout", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				status: 200,
			});
			const client = new ResourceClient({
				apiKey: "client-key",
				baseUrl: "https://apis.roblox.com",
				httpClient,
				sleep: createFakeSleep(),
				timeout: 30_000,
			});

			await client.execute({ parameters: { id: "1" }, spec: TEST_UPLOAD_SPEC });

			expect(httpClient.requests[0]?.config).toStrictEqual({
				apiKey: "client-key",
				baseUrl: "https://apis.roblox.com",
			});
		});

		it("should apply an explicit per-request timeout to an upload request", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				status: 200,
			});
			const client = new ResourceClient({
				apiKey: "client-key",
				httpClient,
				sleep: createFakeSleep(),
				timeout: 30_000,
			});

			await client.execute({
				options: { timeout: 1000 },
				parameters: { id: "1" },
				spec: TEST_UPLOAD_SPEC,
			});

			expect(httpClient.requests[0]?.config.timeout).toBe(1000);
		});

		it("should keep the default timeout for a JSON request with no per-request timeout", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				status: 200,
			});
			const client = new ResourceClient({
				apiKey: "client-key",
				httpClient,
				sleep: createFakeSleep(),
				timeout: 30_000,
			});

			await client.execute({ parameters: { id: "1" }, spec: TEST_CREATE_SPEC });

			expect(httpClient.requests[0]?.config.timeout).toBe(30_000);
		});
	});

	describe("rate-limit queues", () => {
		it("should route a per-request apiKey override through a separate queue", async () => {
			expect.assertions(1);

			const httpClient = mockManyOk(createFakeHttpClient({ schemaValidation: "off" }), 11);
			const clock = createFakeClock();
			const client = new ResourceClient({
				apiKey: "default-key",
				httpClient,
				sleep: clock.sleep,
			});

			for (let index = 0; index < 10; index++) {
				await client.execute({ parameters: { id: "x" }, spec: TEST_GET_SPEC });
			}

			await client.execute({
				options: { apiKey: "override-key" },
				parameters: { id: "x" },
				spec: TEST_GET_SPEC,
			});

			expect(clock.waits).toStrictEqual([]);
		});

		it("should re-use a queue when the same effective apiKey is supplied", async () => {
			expect.assertions(1);

			// Eleven calls through the same effective apiKey exhaust the
			// burst allowance and force a wait, proving every call routes
			// through the same cached queue instance.
			const httpClient = mockManyOk(createFakeHttpClient({ schemaValidation: "off" }), 11);
			const clock = createFakeClock();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			for (let index = 0; index < 11; index++) {
				await client.execute({ parameters: { id: "x" }, spec: TEST_GET_SPEC });
			}

			expect(clock.waits).toStrictEqual([100]);
		});
	});

	describe("retry orchestration", () => {
		it("should retry a 429 for idempotent-kind specs", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ status: 200 });
			const sleep = createFakeSleep();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep,
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
			expect(sleep.waits).toStrictEqual([1000]);
		});

		it("should retry a 5xx for idempotent-kind specs", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockApiError({ statusCode: 500 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
		});

		it("should retry a 429 for create-kind specs", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: TEST_CREATE_SPEC,
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
		});

		it("should not retry a 5xx for create-kind specs", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockApiError({ statusCode: 500 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: TEST_CREATE_SPEC,
			});

			assert(!result.success);

			expect(httpClient.requests).toHaveLength(1);
		});

		it("should surface a non-retryable error without further attempts", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockApiError({
				statusCode: 404,
			});
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should surface a parser failure as the final Result when HTTP succeeds", async () => {
			expect.assertions(1);

			// HTTP returns 201; the test spec's parser rejects anything
			// other than 200 and wraps the status in an ApiError.
			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				status: 201,
			});
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err.statusCode).toBe(201);
		});
	});

	describe("permission upgrade", () => {
		it("should upgrade a 401 ApiError to PermissionError when the spec declares scopes", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockApiError({
				statusCode: 401,
			});
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: {
					...TEST_GET_SPEC,
					operationLimit: Object.freeze({
						maxPerSecond: 10,
						operationKey: "test.scoped-get",
					}),
					requiredScopes: ["test:read"],
				},
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.statusCode).toBe(401);
			expect(result.err.requiredScopes).toStrictEqual(["test:read"]);
			expect(result.err.operationKey).toBe("test.scoped-get");
			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should upgrade a 403 ApiError to PermissionError when the spec declares scopes", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockApiError({
				statusCode: 403,
			});
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: {
					...TEST_CREATE_SPEC,
					requiredScopes: ["test:write"],
				},
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.statusCode).toBe(403);
			expect(result.err.requiredScopes).toStrictEqual(["test:write"]);
		});

		it("should preserve message, code, and cause from the original ApiError on upgrade", async () => {
			expect.assertions(4);

			const upstream = new Error("upstream-failure");
			const original = new ApiError("missing scope", {
				cause: upstream,
				code: "INSUFFICIENT_SCOPE",
				statusCode: 403,
			});
			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(
				original,
			);
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: {
					...TEST_GET_SPEC,
					requiredScopes: ["test:read"],
				},
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.message).toBe("missing scope");
			expect(result.err.code).toBe("INSUFFICIENT_SCOPE");
			expect(result.err.cause).toBe(upstream);
			expect(result.err.name).toBe("PermissionError");
		});

		it("should return an existing PermissionError unchanged instead of re-wrapping it", async () => {
			expect.assertions(1);

			const existing = new PermissionError("already enriched", {
				operationKey: "upstream.scoped",
				requiredScopes: ["upstream:read"],
				statusCode: 403,
			});
			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(
				existing,
			);
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: {
					...TEST_GET_SPEC,
					requiredScopes: ["test:read"],
				},
			});

			assert(!result.success);

			expect(result.err).toBe(existing);
		});

		it("should leave a 401 ApiError unchanged when the spec declares no scopes", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockApiError({
				statusCode: 401,
			});
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).not.toBeInstanceOf(PermissionError);
		});

		it("should leave a non-permission status unchanged even when the spec declares scopes", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockApiError({
				statusCode: 404,
			});
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.execute({
				parameters: { id: "1" },
				spec: {
					...TEST_GET_SPEC,
					requiredScopes: ["test:read"],
				},
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).not.toBeInstanceOf(PermissionError);
		});
	});

	describe("hooks", () => {
		it("should fire onRequest for every attempt including retries", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ status: 200 });
			const onRequest = vi.fn<NonNullable<OpenCloudHooks["onRequest"]>>();
			const client = new ResourceClient({
				apiKey: "test-key",
				hooks: { onRequest },
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.execute({ parameters: { id: "1" }, spec: TEST_GET_SPEC });

			expect(onRequest).toHaveBeenCalledTimes(2);
		});

		it("should fire onRetry with the 1-indexed attempt before the retry sleep", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockResponse({ status: 200 });
			const onRetry = vi.fn<NonNullable<OpenCloudHooks["onRetry"]>>();
			const client = new ResourceClient({
				apiKey: "test-key",
				hooks: { onRetry },
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.execute({ parameters: { id: "1" }, spec: TEST_GET_SPEC });

			expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, expect.any(Error));
		});

		it("should fire onRateLimit with the computed wait before sleeping on retry", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 2 })
				.mockResponse({ status: 200 });
			const sleep = createFakeSleep();
			const onRateLimit = vi.fn<NonNullable<OpenCloudHooks["onRateLimit"]>>();
			const client = new ResourceClient({
				apiKey: "test-key",
				hooks: { onRateLimit },
				httpClient,
				sleep,
			});

			await client.execute({ parameters: { id: "1" }, spec: TEST_GET_SPEC });

			expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(2000);
			expect(sleep.waits).toStrictEqual([2000]);
		});
	});
});
