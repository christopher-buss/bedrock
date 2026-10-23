import { assert, describe, it, vi } from "vitest";

import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import type { Credential, HttpRequest } from "../client/types.ts";
import { ApiError } from "../errors/api-error.ts";
import { CredentialError } from "../errors/credential-error.ts";
import { RequestAbortedError } from "../errors/request-aborted.ts";
import { RequestDeadlineExceededError } from "../errors/request-deadline-exceeded.ts";
import type { Result } from "../types.ts";
import { IDEMPOTENT_METHOD_DEFAULTS } from "./http/retry.ts";
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

/** One request a second, no burst: a second call on one queue waits. */
const PACED_SPEC: ResourceMethodSpec<undefined, true> = {
	...GET_SPEC,
	operationLimit: Object.freeze({
		burstCapacity: 1,
		maxPerSecond: 1,
		operationKey: "test.paced",
	}),
};

type TokenProvider = Extract<Credential, { kind: "oauth" }>["getAccessToken"];

function oauth(identity: string, getAccessToken: TokenProvider = () => "token"): Credential {
	return { getAccessToken, identity, kind: "oauth" };
}

describe("resourceClient OAuth credential", () => {
	it("should send the provider's token as the resolved OAuth credential", async ({ expect }) => {
		expect.assertions(3);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			status: 200,
		});
		const getAccessToken = vi.fn<TokenProvider>(() => "access-token");
		const client = new ResourceClient({
			credential: oauth("user-1", getAccessToken),
			httpClient,
			sleep: createFakeSleep(),
		});

		const { signal } = new AbortController();

		const result = await client.executeAsync({
			options: { signal },
			parameters: undefined,
			spec: GET_SPEC,
		});

		expect(result.success).toBe(true);
		expect(httpClient.requests[0]!.config.credential).toStrictEqual({
			accessToken: "access-token",
			kind: "oauth",
		});
		expect(getAccessToken).toHaveBeenCalledExactlyOnceWith({ signal });
	});

	it("should accept an async provider", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			status: 200,
		});
		const client = new ResourceClient({
			credential: oauth("user-1", async () => "async-token"),
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		expect(httpClient.requests[0]!.config.credential).toStrictEqual({
			accessToken: "async-token",
			kind: "oauth",
		});
	});

	it("should pass the request's signal to the provider", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			status: 200,
		});
		const controller = new AbortController();
		const signals: Array<AbortSignal> = [];
		const client = new ResourceClient({
			credential: oauth("user-1", ({ signal }) => {
				signals.push(signal);
				return "token";
			}),
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.executeAsync({
			options: { signal: controller.signal },
			parameters: undefined,
			spec: GET_SPEC,
		});

		expect(signals).toStrictEqual([controller.signal]);
	});

	it("should give the provider a live signal when the caller passes none", async ({ expect }) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			status: 200,
		});
		const signals: Array<AbortSignal> = [];
		const client = new ResourceClient({
			credential: oauth("user-1", ({ signal }) => {
				signals.push(signal);
				return "token";
			}),
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		expect(signals[0]).toBeInstanceOf(AbortSignal);
		expect(signals[0]!.aborted).toBe(false);
	});

	it("should call the provider again for each retried attempt, after the retry wait", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockApiError({ statusCode: 503 })
			.mockResponse({ status: 200 });
		const sleep = createFakeSleep();
		const waitsSeenByProvider: Array<number> = [];
		let calls = 0;
		const client = new ResourceClient({
			credential: oauth("user-1", () => {
				waitsSeenByProvider.push(sleep.waits.length);
				calls += 1;
				return `token-${calls}`;
			}),
			httpClient,
			sleep,
		});

		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		expect(httpClient.requests.map(({ config }) => config.credential)).toStrictEqual([
			{ accessToken: "token-1", kind: "oauth" },
			{ accessToken: "token-2", kind: "oauth" },
		]);
		expect(waitsSeenByProvider).toStrictEqual([0, 1]);
	});

	it("should call the provider after the rate-limit queue wait", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 });
		const sleep = createFakeSleep();
		const waitsSeenByProvider: Array<number> = [];
		const client = new ResourceClient({
			credential: oauth("user-1", () => {
				waitsSeenByProvider.push(sleep.waits.length);
				return "token";
			}),
			httpClient,
			sleep,
		});

		await client.executeAsync({ parameters: undefined, spec: PACED_SPEC });
		await client.executeAsync({ parameters: undefined, spec: PACED_SPEC });

		expect(waitsSeenByProvider).toStrictEqual([0, 1]);
	});

	it("should return CredentialError without sending or retrying when the provider throws", async ({
		expect,
	}) => {
		expect.assertions(4);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" });
		const providerError = new Error("grant revoked");
		const getAccessToken = vi.fn<TokenProvider>(() => {
			throw providerError;
		});
		const client = new ResourceClient({
			credential: oauth("user-1", getAccessToken),
			httpClient,
			maxRetries: 3,
			sleep: createFakeSleep(),
		});

		const { signal } = new AbortController();

		const result = await client.executeAsync({
			options: { signal },
			parameters: undefined,
			spec: GET_SPEC,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(CredentialError);
		expect(result.err.cause).toBe(providerError);
		expect(getAccessToken).toHaveBeenCalledExactlyOnceWith({ signal });
		expect(httpClient.requests).toHaveLength(0);
	});

	it("should return CredentialError when the provider rejects", async ({ expect }) => {
		expect.assertions(3);

		const providerError = new Error("token endpoint down");
		const client = new ResourceClient({
			credential: oauth("user-1", async () => {
				throw providerError;
			}),
			httpClient: createFakeHttpClient({ schemaValidation: "off" }),
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(CredentialError);
		expect(result.err.cause).toBe(providerError);
		expect(result.err.message).toBe("OAuth credential provider failed");
	});

	it("should return RequestAbortedError when the caller aborts while the provider runs", async ({
		expect,
	}) => {
		expect.assertions(2);

		const controller = new AbortController();
		const httpClient = createFakeHttpClient({ schemaValidation: "off" });
		const client = new ResourceClient({
			credential: oauth("user-1", async ({ signal }) => {
				controller.abort(new Error("superseded"));
				throw signal.reason;
			}),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({
			options: { signal: controller.signal },
			parameters: undefined,
			spec: GET_SPEC,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(RequestAbortedError);
		expect(httpClient.requests).toHaveLength(0);
	});

	it("should return RequestDeadlineExceededError when the deadline passes while the provider runs", async ({
		expect,
	}) => {
		expect.assertions(2);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" });
		const client = new ResourceClient({
			credential: oauth("user-1", async ({ signal }) => {
				return new Promise<string>((_resolve, reject) => {
					signal.addEventListener("abort", () => {
						reject(new Error("provider gave up"));
					});
				});
			}),
			httpClient,
			sleep: createFakeSleep(),
		});

		const result = await client.executeAsync({
			options: { deadlineMs: Date.now() + 10 },
			parameters: undefined,
			spec: GET_SPEC,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(RequestDeadlineExceededError);
		expect(httpClient.requests).toHaveLength(0);
	});

	it("should use a per-request OAuth override over the client API key", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			status: 200,
		});
		const client = new ResourceClient({
			credential: { apiKey: "client-key", kind: "apiKey" },
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.executeAsync({
			options: { credential: oauth("user-1", () => "override-token") },
			parameters: undefined,
			spec: GET_SPEC,
		});

		expect(httpClient.requests[0]!.config.credential).toStrictEqual({
			accessToken: "override-token",
			kind: "oauth",
		});
	});

	it("should call a class-method provider with its instance", async ({ expect }) => {
		expect.assertions(1);

		class TokenSource {
			readonly #token = "instance-token";

			public readonly identity = "user-1";
			public readonly kind = "oauth" as const;

			public getAccessToken(): string {
				return this.#token;
			}
		}

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			status: 200,
		});
		const client = new ResourceClient({
			credential: new TokenSource(),
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		expect(httpClient.requests[0]!.config.credential).toStrictEqual({
			accessToken: "instance-token",
			kind: "oauth",
		});
	});

	it("should resolve an API-key credential to its key only", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
			status: 200,
		});
		const client = new ResourceClient({
			credential: { apiKey: "client-key", kind: "apiKey" },
			httpClient,
			sleep: createFakeSleep(),
		});

		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		expect(httpClient.requests[0]!.config.credential).toStrictEqual({
			apiKey: "client-key",
			kind: "apiKey",
		});
	});
});

describe("resourceClient credential identity", () => {
	const spentBudget = {
		headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "60" },
		status: 200,
	};

	it("should not pace two OAuth identities against each other", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 });
		const sleep = createFakeSleep();
		const client = new ResourceClient({ credential: oauth("user-1"), httpClient, sleep });

		await client.executeAsync({ parameters: undefined, spec: PACED_SPEC });
		await client.executeAsync({
			options: { credential: oauth("user-2") },
			parameters: undefined,
			spec: PACED_SPEC,
		});

		expect(sleep.waits).toStrictEqual([]);
	});

	it("should pace one OAuth identity across token changes", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 });
		const sleep = createFakeSleep();
		let calls = 0;
		const client = new ResourceClient({
			credential: oauth("user-1", () => {
				calls += 1;
				return `token-${calls}`;
			}),
			httpClient,
			sleep,
		});

		await client.executeAsync({ parameters: undefined, spec: PACED_SPEC });
		await client.executeAsync({ parameters: undefined, spec: PACED_SPEC });

		expect(sleep.waits).toHaveLength(1);
	});

	it("should pace on the OAuth identity given at construction", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 });
		const sleep = createFakeSleep();
		const credential = {
			getAccessToken: () => "token",
			identity: "user-1",
			kind: "oauth" as const,
		};
		const client = new ResourceClient({ credential, httpClient, sleep });

		await client.executeAsync({ parameters: undefined, spec: PACED_SPEC });
		credential.identity = "user-2";
		await client.executeAsync({ parameters: undefined, spec: PACED_SPEC });

		expect(sleep.waits).toHaveLength(1);
	});

	it("should keep an OAuth identity apart from an equal API key", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockResponse({ status: 200 })
			.mockResponse({ status: 200 });
		const sleep = createFakeSleep();
		const client = new ResourceClient({
			credential: { apiKey: "same", kind: "apiKey" },
			httpClient,
			sleep,
		});

		await client.executeAsync({ parameters: undefined, spec: PACED_SPEC });
		await client.executeAsync({
			options: { credential: oauth("same") },
			parameters: undefined,
			spec: PACED_SPEC,
		});

		expect(sleep.waits).toStrictEqual([]);
	});

	it("should not hold one OAuth identity on another's spent budget", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockResponse(spentBudget)
			.mockResponse({ status: 200 });
		const sleep = createFakeSleep();
		const client = new ResourceClient({ credential: oauth("user-1"), httpClient, sleep });

		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });
		await client.executeAsync({
			options: { credential: oauth("user-2") },
			parameters: undefined,
			spec: GET_SPEC,
		});

		expect(sleep.waits).toStrictEqual([]);
	});

	it("should give back the budget slot of an attempt the provider failed", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(2);

		vi.useFakeTimers({ now: 0, toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockResponse({
				headers: { "x-ratelimit-remaining": "2", "x-ratelimit-reset": "60" },
				status: 200,
			})
			.mockResponse({ status: 200 });
		const sleep = createFakeSleep();
		const getAccessToken = vi
			.fn<TokenProvider>(() => "token")
			.mockReturnValueOnce("token")
			.mockThrowOnce(new Error("grant revoked"));
		const client = new ResourceClient({
			credential: oauth("user-1", getAccessToken),
			httpClient,
			sleep,
		});

		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });
		const failed = await client.executeAsync({ parameters: undefined, spec: GET_SPEC });
		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		expect(failed.success).toBeFalse();
		// Two slots left over 60s, so one every 30s: the failed attempt took
		// none.
		expect(sleep.waits).toStrictEqual([30_000, 30_000]);
	});

	it("should hold one OAuth identity on its own spent budget", async ({ expect }) => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" })
			.mockResponse(spentBudget)
			.mockResponse({ status: 200 });
		const sleep = createFakeSleep();
		const client = new ResourceClient({ credential: oauth("user-1"), httpClient, sleep });

		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });
		await client.executeAsync({ parameters: undefined, spec: GET_SPEC });

		expect(sleep.waits).toHaveLength(1);
	});
});
