import { assert, describe, it } from "vitest";

import { ApiError } from "#src/errors/api-error";
import { NetworkError } from "#src/errors/network-error";
import { PermissionError } from "#src/errors/permission-error";
import { UniversesClient } from "#src/resources/universes/client";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validUniverseBody } from "#tests/helpers/universes";

describe("universe activation", () => {
	it.for(["activate", "deactivate"] as const)(
		"should preserve explicitly requested retries for %s failures other than 504",
		async (operation, { expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({ body: {}, status: 200 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});
			const result = await client[operation](
				{ universeId: "42" },
				{ maxRetries: 1, retryableStatuses: [500, 504], retryDelay: () => 0 },
			);

			expect(result).toStrictEqual({ data: undefined, success: true });
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"POST",
			]);
		},
	);

	it("should recognize the legacy error envelope when explaining activation eligibility", async ({
		expect,
	}) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient().mockError(
			new ApiError("forbidden", {
				code: "3",
				details: { errors: [{ code: 3, message: "forbidden" }] },
				statusCode: 403,
			}),
		);
		const client = new UniversesClient({
			credential: { apiKey: "test-key", kind: "apiKey" },
			httpClient,
		});
		const result = await client.activate({ universeId: "42" });
		assert(!result.success);

		expect(result.err.message).toContain("missing content maturity rating");
	});

	it.for([
		["activate", "PUBLIC"],
		["deactivate", "PRIVATE"],
	] as const)(
		"should preserve %s overrides while verifying a 504",
		async ([operation, visibility], { expect }) => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 504 })
				.mockResponse({
					body: validUniverseBody({ visibility }),
					status: 200,
				});
			const client = new UniversesClient({
				credential: { apiKey: "default", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});
			const { signal } = new AbortController();
			const result = await client[operation](
				{ universeId: "42" },
				{
					baseUrl: "https://custom.example",
					credential: { apiKey: "override", kind: "apiKey" },
					deadlineMs: Date.now() + 10_000,
					maxRetries: 2,
					retryableStatuses: [429, 504],
					signal,
				},
			);

			expect(result.success).toBe(true);
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
			]);
			expect(httpClient.requests.map(({ config }) => config.baseUrl)).toStrictEqual([
				"https://custom.example",
				"https://custom.example",
			]);
			expect(httpClient.requests.map(({ config }) => config.credential)).toStrictEqual([
				{ apiKey: "override", kind: "apiKey" },
				{ apiKey: "override", kind: "apiKey" },
			]);
		},
	);

	it.for([
		["activate", "PRIVATE"],
		["deactivate", "PUBLIC"],
		["activate", "VISIBILITY_UNSPECIFIED"],
		["deactivate", "VISIBILITY_UNSPECIFIED"],
	] as const)(
		"should preserve the ambiguous %s error when visibility is %s",
		async ([operation, visibility], { expect }) => {
			expect.assertions(2);

			const original = new ApiError("upstream request timeout", { statusCode: 504 });
			const httpClient = createFakeHttpClient()
				.mockError(original)
				.mockResponse({ body: validUniverseBody({ visibility }), status: 200 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
			});
			const result = await client[operation]({ universeId: "42" });
			assert(!result.success);

			expect(result.err).toBe(original);
			expect(httpClient.requests).toHaveLength(2);
		},
	);

	it.for(["activate", "deactivate"] as const)(
		"should preserve the %s timeout when verification fails",
		async (operation, { expect }) => {
			expect.assertions(2);

			const original = new ApiError("upstream request timeout", { statusCode: 504 });
			const httpClient = createFakeHttpClient()
				.mockError(original)
				.mockApiError({ statusCode: 403 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
			});
			const result = await client[operation]({ universeId: "42" });
			assert(!result.success);

			expect(result.err).toBe(original);
			expect(httpClient.requests).toHaveLength(2);
		},
	);

	it.for([
		new NetworkError("offline"),
		new ApiError("unknown universe", { details: { code: 1 }, statusCode: 400 }),
		new ApiError("bad request", { code: "3", statusCode: 400 }),
		new ApiError("under review", { details: { code: 6 }, statusCode: 403 }),
		new ApiError("forbidden", { statusCode: 403 }),
	] as const)("should preserve unrelated activation errors %#", async (original, { expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient().mockError(original);
		const client = new UniversesClient({
			credential: { apiKey: "test-key", kind: "apiKey" },
			httpClient,
		});
		const result = await client.activate({ universeId: "42" });
		assert(!result.success);

		expect(result.err.message).toBe(original.message);
		expect(httpClient.requests).toHaveLength(1);
	});

	it("should explain legacy code 3 and leave deactivation refusals unchanged", async ({
		expect,
	}) => {
		expect.assertions(3);

		const original = new ApiError("forbidden", { code: "3", statusCode: 403 });
		const httpClient = createFakeHttpClient().mockError(original).mockError(original);
		const client = new UniversesClient({
			credential: { apiKey: "test-key", kind: "apiKey" },
			httpClient,
		});
		const activated = await client.activate({ universeId: "42" });
		const deactivated = await client.deactivate({ universeId: "42" });
		assert(!activated.success && !deactivated.success);

		expect(activated.err.message).toContain("missing content maturity rating");
		expect(deactivated.err.message).toBe("forbidden");
		expect(httpClient.requests).toHaveLength(2);
	});

	it.for([
		["activate", "PUBLIC"],
		["deactivate", "PRIVATE"],
	] as const)(
		"should confirm %s after an ambiguous 504 without repeating the write",
		async ([operation, visibility], { expect }) => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 504 })
				.mockResponse({ body: validUniverseBody({ visibility }), status: 200 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});
			const result = await client[operation]({ universeId: "42" });

			expect(result).toStrictEqual({ data: undefined, success: true });
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
			]);
			expect(httpClient.requests[1]!.request.url).toBe("/cloud/v2/universes/42");
		},
	);

	it("should explain that activation code 3 may mean a missing maturity rating", async ({
		expect,
	}) => {
		expect.assertions(5);

		const original = new ApiError(
			"HTTP 403: You are not authorized to configure this universe.",
			{
				details: {
					code: 3,
					field: "universeId",
					message: "You are not authorized to configure this universe.",
				},
				method: "POST",
				statusCode: 403,
				url: "https://apis.roblox.com/legacy-develop/v1/universes/42/activate",
			},
		);
		const httpClient = createFakeHttpClient().mockError(original);
		const client = new UniversesClient({
			credential: { apiKey: "test-key", kind: "apiKey" },
			httpClient,
		});
		const result = await client.activate({ universeId: "42" });
		assert(!result.success);

		expect(result.err).toBeInstanceOf(PermissionError);
		expect(result.err.message).toContain("missing content maturity rating");
		expect(result.err.message).toContain("possible cause");
		expect(result.err).toMatchObject({
			details: original.details,
			method: "POST",
			operationKey: "universes.activate",
			requiredScopes: ["legacy-universe:manage"],
			statusCode: 403,
			url: original.url,
		});
		expect(httpClient.requests).toHaveLength(1);
	});

	it.for(["activate", "deactivate"] as const)(
		"should %s an experience with an API key",
		async (operation, { expect }) => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});
			const result = await client[operation]({ universeId: "42" });

			expect(result).toStrictEqual({ data: undefined, success: true });
			expect(httpClient.requests[0]!.request).toStrictEqual({
				method: "POST",
				url: `/legacy-develop/v1/universes/42/${operation}`,
			});
			expect(httpClient.requests[0]!.config.credential).toStrictEqual({
				apiKey: "test-key",
				kind: "apiKey",
			});
		},
	);
});
