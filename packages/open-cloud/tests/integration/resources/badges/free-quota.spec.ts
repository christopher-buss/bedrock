import { assert, describe, it } from "vitest";

import { ApiError } from "#src/errors/api-error";
import { CredentialRejectedError } from "#src/errors/credential-rejected";
import { NetworkError } from "#src/errors/network-error";
import { RateLimitError } from "#src/errors/rate-limit";
import { UnexpectedResponseError } from "#src/errors/unexpected-response";
import { BadgesClient } from "#src/resources/badges/index";
import { loadFixture } from "#tests/conformance/_helpers";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

const OAUTH_CREDENTIAL = {
	getAccessToken: () => {
		throw new Error("an unauthenticated read must not ask for a token");
	},
	identity: "user-1",
	kind: "oauth",
} as const;

/**
 * Builds the 429 the endpoint sends: an edge body and a 5 s `retry-after`
 * that is too short, since the window reopens only at `x-ratelimit-reset`.
 *
 * @param responseHeaders - The allowlisted headers of the 429.
 * @returns The rate-limit error the transport mints for it.
 */
function quotaRateLimit(responseHeaders?: Readonly<Record<string, string>>): RateLimitError {
	return new RateLimitError("Rate limited", {
		details: { errors: [{ code: 0, message: "" }] },
		responseHeaders,
		retryAfterSeconds: 5,
		source: "edge",
		statusCode: 429,
	});
}

function connectionReset(): NetworkError {
	return new NetworkError("socket reset", {
		cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
	});
}

describe(BadgesClient, () => {
	describe("getFreeQuota", () => {
		it("should read the free badges left today from badges.roblox.com with no credential", async ({
			expect,
		}) => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: loadFixture("badges", "free-badges-quota-response.json"),
				status: 200,
			});
			const client = new BadgesClient({
				credential: OAUTH_CREDENTIAL,
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.getFreeQuota({ universeId: "999" });

			assert(result.success);

			expect(result.data).toBe(5);
			expect(httpClient.requests[0]!.request).toStrictEqual({
				method: "GET",
				url: "/v1/universes/999/free-badges-quota",
			});
			expect(httpClient.requests[0]!.config).toMatchObject({
				baseUrl: "https://badges.roblox.com",
				credential: { kind: "none" },
			});
		});

		it("should read the quota from a client built with no credential", async ({ expect }) => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: loadFixture("badges", "free-badges-quota-response.json"),
				status: 200,
			});
			const client = new BadgesClient({
				credential: { kind: "none" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.getFreeQuota({ universeId: "999" });

			expect(result).toStrictEqual({ data: 5, success: true });
		});

		it("should send no credential on an authenticated call from a client built with none", async ({
			expect,
		}) => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 401 });
			const client = new BadgesClient({
				credential: { kind: "none" },
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.update({ badgeId: "1", enabled: true });

			expect(httpClient.requests[0]!.config).toMatchObject({ credential: { kind: "none" } });
		});

		it("should not read a 401 as a refused OAuth token, since no token was sent", async ({
			expect,
		}) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 401 });
			const client = new BadgesClient({
				credential: OAUTH_CREDENTIAL,
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.getFreeQuota({ universeId: "999" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err).not.toBeInstanceOf(CredentialRejectedError);
		});

		it("should wait out a 429 until x-ratelimit-reset, not retry-after, then read", async ({
			expect,
		}) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(quotaRateLimit({ "retry-after": "5", "x-ratelimit-reset": "42" }))
				.mockResponse({ body: 3, status: 200 });
			const clock = createFakeClock();
			const client = new BadgesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: clock.sleep,
			});

			const result = await client.getFreeQuota({ universeId: "999" });

			expect(result).toStrictEqual({ data: 3, success: true });
			expect(clock.waits).toStrictEqual([42_000]);
		});

		it("should keep retry-after on a 429 that reports no reset", async ({ expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(quotaRateLimit())
				.mockResponse({ body: 3, status: 200 });
			const clock = createFakeClock();
			const client = new BadgesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: clock.sleep,
			});

			const result = await client.getFreeQuota({ universeId: "999" });

			expect(result).toStrictEqual({ data: 3, success: true });
			expect(clock.waits).toStrictEqual([5000]);
		});

		it("should retry a network error, then fail once retries run out", async ({ expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(connectionReset())
				.mockError(connectionReset())
				.mockError(connectionReset())
				.mockError(connectionReset());
			const client = new BadgesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.getFreeQuota({ universeId: "999" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(NetworkError);
			expect(httpClient.requests).toHaveLength(4);
		});

		it("should read a spent quota as zero", async ({ expect }) => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({ body: 0, status: 200 });
			const client = new BadgesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.getFreeQuota({ universeId: "999" });

			expect(result).toStrictEqual({ data: 0, success: true });
		});

		it.for([-1, 1.5, "5", undefined])(
			"should reject a quota body of %s that is not a count",
			async (body, { expect }) => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
					body,
					status: 200,
				});
				const client = new BadgesClient({
					credential: { apiKey: "test-key", kind: "apiKey" },
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.getFreeQuota({ universeId: "999" });

				assert(!result.success);

				expect(result.err).toBeInstanceOf(UnexpectedResponseError);
				expect(result.err.message).toContain("Malformed free badge quota response");
			},
		);
	});
});
