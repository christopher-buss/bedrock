import { assert, describe, it, vi } from "vitest";

import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import type { Credential, HttpRequest } from "../client/types.ts";
import { ApiError } from "../errors/api-error.ts";
import { CredentialNotSupportedError } from "../errors/credential-not-supported.ts";
import type { Result } from "../types.ts";
import { IDEMPOTENT_METHOD_DEFAULTS } from "./http/retry.ts";
import { okRequest, ResourceClient, type ResourceMethodSpec } from "./resource-client.ts";

function parseOk(response: { readonly status: number }): Result<true, ApiError> {
	return response.status === 200
		? { data: true, success: true }
		: { err: new ApiError("rejected", { statusCode: response.status }), success: false };
}

const API_KEY_ONLY_SPEC: ResourceMethodSpec<undefined, true> = {
	apiKeyOnly: true,
	buildRequest: () => okRequest({ method: "GET", url: "/test" } satisfies HttpRequest),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: Object.freeze({ maxPerSecond: 10, operationKey: "test.keyOnly" }),
	parse: parseOk,
};

type TokenProvider = Extract<Credential, { kind: "oauth" }>["getAccessToken"];

describe("resourceClient API-key-only operations", () => {
	it("should return CredentialNotSupportedError for OAuth without a token or a request", async ({
		expect,
	}) => {
		expect.assertions(5);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" });
		const getAccessToken = vi.fn<TokenProvider>(() => "token");
		const buildRequest = vi.fn<typeof API_KEY_ONLY_SPEC.buildRequest>(
			API_KEY_ONLY_SPEC.buildRequest,
		);
		const client = new ResourceClient({
			credential: { getAccessToken, identity: "user-1", kind: "oauth" },
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({
			parameters: undefined,
			spec: { ...API_KEY_ONLY_SPEC, buildRequest },
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(CredentialNotSupportedError);
		expect(result.err).toMatchObject({
			message: "Operation test.keyOnly accepts only an API key credential",
			operationKey: "test.keyOnly",
		});
		expect(getAccessToken).not.toHaveBeenCalled();
		expect(buildRequest).not.toHaveBeenCalled();
		expect(httpClient.requests).toHaveLength(0);
	});

	it("should reject a per-request OAuth override on an API-key client", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" });
		const client = new ResourceClient({
			credential: { apiKey: "key", kind: "apiKey" },
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({
			options: {
				credential: { getAccessToken: () => "token", identity: "user-1", kind: "oauth" },
			},
			parameters: undefined,
			spec: API_KEY_ONLY_SPEC,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(CredentialNotSupportedError);
		expect(httpClient.requests).toHaveLength(0);
	});

	it("should send an API-key call to an API-key-only operation", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			status: 200,
		});
		const client = new ResourceClient({
			credential: { apiKey: "key", kind: "apiKey" },
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({
			parameters: undefined,
			spec: API_KEY_ONLY_SPEC,
		});

		expect(result.success).toBe(true);
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should send an OAuth call to an operation without the flag", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			status: 200,
		});
		const client = new ResourceClient({
			credential: { getAccessToken: () => "token", identity: "user-1", kind: "oauth" },
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({
			parameters: undefined,
			spec: { ...API_KEY_ONLY_SPEC, apiKeyOnly: false },
		});

		expect(result.success).toBe(true);
	});
});
