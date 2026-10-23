import { assert, describe, it, vi } from "vitest";

import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import type { Credential, HttpRequest } from "../client/types.ts";
import { ApiError } from "../errors/api-error.ts";
import { CredentialRejectedError } from "../errors/credential-rejected.ts";
import { NetworkError } from "../errors/network-error.ts";
import { PermissionError } from "../errors/permission-error.ts";
import type { Result } from "../types.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "./http/retry.ts";
import { okRequest, ResourceClient, type ResourceMethodSpec } from "./resource-client.ts";

function parseOk(response: { readonly status: number }): Result<true, ApiError> {
	return response.status === 200
		? { data: true, success: true }
		: { err: new ApiError("rejected", { statusCode: response.status }), success: false };
}

const GET_SPEC: ResourceMethodSpec<undefined, true> = {
	buildRequest: () => okRequest({ method: "GET", url: "/test" } satisfies HttpRequest),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: Object.freeze({ maxPerSecond: 10, operationKey: "test.get" }),
	parse: parseOk,
};

const CREATE_SPEC: ResourceMethodSpec<undefined, true> = {
	...GET_SPEC,
	buildRequest: () => okRequest({ method: "POST", url: "/test" } satisfies HttpRequest),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
};

const SCOPED_SPEC: ResourceMethodSpec<undefined, true> = {
	...GET_SPEC,
	requiredScopes: ["test:read"],
};

const API_KEY: Credential = { apiKey: "key-1", kind: "apiKey" };

type TokenProvider = Extract<Credential, { kind: "oauth" }>["getAccessToken"];

function oauth(identity: string, getAccessToken: TokenProvider = () => "token"): Credential {
	return { getAccessToken, identity, kind: "oauth" };
}

function scopeFailure502(): ApiError {
	return new ApiError("HTTP 502: Scope authorization failed.", {
		details: { message: "Scope authorization failed." },
		statusCode: 502,
	});
}

describe("resourceClient OAuth rejection", () => {
	it("should return CredentialRejectedError with the identity on a 401, sent once", async ({
		expect,
	}) => {
		expect.assertions(2);

		const upstream = new ApiError("HTTP 401: Invalid Token.", {
			code: "UNAUTHENTICATED",
			statusCode: 401,
		});
		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockError(upstream)
			.mockResponse({ status: 200 });
		const getAccessToken = vi.fn<TokenProvider>(() => "secret-token");
		const client = new ResourceClient({
			credential: oauth("user-1", getAccessToken),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: SCOPED_SPEC });

		assert(!result.success);
		assert(result.err instanceof CredentialRejectedError);

		expect(result.err).toMatchObject({
			cause: upstream,
			code: "UNAUTHENTICATED",
			identity: "user-1",
			message: "HTTP 401: Invalid Token.",
			statusCode: 401,
		});
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should not retry a 401 even when the status is retryable", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockApiError({ statusCode: 401 })
			.mockResponse({ status: 200 });
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			retryableStatuses: [401],
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(CredentialRejectedError);
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should return CredentialRejectedError on the scope-failure 502, sent once", async ({
		expect,
	}) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockError(scopeFailure502())
			.mockResponse({ status: 200 });
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		assert(!result.success);
		assert(result.err instanceof CredentialRejectedError);

		expect(result.err.identity).toBe("user-1");
		expect(result.err.statusCode).toBe(502);
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should keep a 403 with the scope-failure message a PermissionError", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(
			new ApiError("HTTP 403: Scope authorization failed.", {
				details: { message: "Scope authorization failed." },
				statusCode: 403,
			}),
		);
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: SCOPED_SPEC });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(PermissionError);
	});

	it("should retry a different 502 on an idempotent call", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockApiError({ message: "Bad Gateway", statusCode: 502 })
			.mockResponse({ status: 200 });
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		expect(result.success).toBe(true);
		expect(httpClient.requests).toHaveLength(2);
	});

	it("should not retry a different 502 on a create", async ({ expect }) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockApiError({ message: "Bad Gateway", statusCode: 502 })
			.mockResponse({ status: 200 });
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: CREATE_SPEC });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err).not.toBeInstanceOf(CredentialRejectedError);
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should keep a gateway 401 an ApiError", async ({ expect }) => {
		expect.assertions(2);

		const gateway = new ApiError("HTTP 401", {
			gatewaySummary: "401 Unauthorized",
			statusCode: 401,
		});
		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(gateway);
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: SCOPED_SPEC });

		assert(!result.success);

		expect(result.err).toBe(gateway);
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should keep a gateway 502 with the scope message an ApiError", async ({ expect }) => {
		expect.assertions(1);

		const gateway = new ApiError("HTTP 502", {
			details: { message: "Scope authorization failed." },
			gatewaySummary: "502 Bad Gateway",
			statusCode: 502,
		});
		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(gateway);
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: CREATE_SPEC });

		assert(!result.success);

		expect(result.err).toBe(gateway);
	});

	it("should leave a non-ApiError failure unchanged", async ({ expect }) => {
		expect.assertions(1);

		const error = new NetworkError("offline");
		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(error);
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: CREATE_SPEC });

		assert(!result.success);

		expect(result.err).toBe(error);
	});

	it("should use the per-request override's identity", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockApiError({
			statusCode: 401,
		});
		const client = new ResourceClient({
			credential: API_KEY,
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({
			options: { credential: oauth("user-2") },
			parameters: undefined,
			spec: GET_SPEC,
		});

		assert(!result.success);
		assert(result.err instanceof CredentialRejectedError);

		expect(result.err.identity).toBe("user-2");
	});

	it("should add the grant hint to an OAuth 403", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(
			new ApiError("HTTP 403: Forbidden", { statusCode: 403 }),
		);
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: SCOPED_SPEC });

		assert(!result.success);
		assert(result.err instanceof PermissionError);

		expect(result.err.message).toBe(
			"HTTP 403: Forbidden. The OAuth grant may not include the required scope or this universe.",
		);
	});

	it("should not double the period before the grant hint", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(
			new ApiError("HTTP 403: Insufficient scope.", { statusCode: 403 }),
		);
		const client = new ResourceClient({
			credential: oauth("user-1"),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: SCOPED_SPEC });

		assert(!result.success);

		expect(result.err.message).toBe(
			"HTTP 403: Insufficient scope. The OAuth grant may not include the required scope or this universe.",
		);
	});
});

describe("resourceClient API-key rejection", () => {
	it("should keep a 401 a PermissionError", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockApiError({
			statusCode: 401,
		});
		const client = new ResourceClient({
			credential: API_KEY,
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: SCOPED_SPEC });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(PermissionError);
		expect(result.err).not.toBeInstanceOf(CredentialRejectedError);
	});

	it("should retry the scope-failure 502 on an idempotent call", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockError(scopeFailure502())
			.mockResponse({ status: 200 });
		const client = new ResourceClient({
			credential: API_KEY,
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		expect(result.success).toBe(true);
		expect(httpClient.requests).toHaveLength(2);
	});

	it("should keep the 403 message unchanged", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(
			new ApiError("HTTP 403: Forbidden", { statusCode: 403 }),
		);
		const client = new ResourceClient({
			credential: API_KEY,
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: SCOPED_SPEC });

		assert(!result.success);

		expect(result.err.message).toBe("HTTP 403: Forbidden");
	});
});
