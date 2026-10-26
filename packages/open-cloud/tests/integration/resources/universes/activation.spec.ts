import { assert, describe, it } from "vitest";

import { ApiError } from "#src/errors/api-error";
import { NetworkError } from "#src/errors/network-error";
import { PermissionError } from "#src/errors/permission-error";
import { UniversesClient } from "#src/resources/universes/client";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

describe("universe activation", () => {
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
		new NetworkError("offline"),
		new ApiError("bad request", { code: "3", statusCode: 400 }),
		new ApiError("unknown universe", { details: { code: 1 }, statusCode: 400 }),
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
