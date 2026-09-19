import { assert, describe, expect, it, vi } from "vitest";

import { CodedError } from "#tests/helpers/coded-error";
import { createFakeClock } from "#tests/helpers/fake-clock";
import {
	createFakeHttpClient,
	type FakeHttpClient,
} from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import type {
	AdmissionWait,
	HttpClient,
	HttpRequest,
	OpenCloudHooks,
	SleepFunc,
} from "../client/types.ts";
import { ApiError } from "../errors/api-error.ts";
import { NetworkError } from "../errors/network-error.ts";
import { PermissionError } from "../errors/permission-error.ts";
import { RequestAbortedError } from "../errors/request-aborted.ts";
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

/**
 * Spends the burst allowance of {@link TEST_GET_SPEC}, so the next call
 * through the same client is held by the operation queue.
 *
 * @param client - The client whose queue should be saturated.
 */
async function spendBurstAsync(client: ResourceClient): Promise<void> {
	for (let index = 0; index < BURST_CALLS; index++) {
		await client.executeAsync({ parameters: { id: "burst" }, spec: TEST_GET_SPEC });
	}
}

const BURST_CALLS = 10;

function mockManyOk(fake: FakeHttpClient, count: number): FakeHttpClient {
	for (let index = 0; index < count; index++) {
		fake.mockResponse({ status: 200 });
	}

	return fake;
}

/**
 * A sleep whose first call blocks until `release` is called, so a test can
 * hold one request inside the queue while another joins behind it. Later
 * calls fall straight through to the clock.
 *
 * @param clock - The fake clock every sleep advances.
 * @returns The sleep, a promise for its first call, and the release trigger.
 */
function createHoldingSleep(clock: { readonly sleep: SleepFunc }): {
	readonly firstStarted: Promise<void>;
	readonly release: () => void;
	readonly sleep: SleepFunc;
} {
	const firstStarted = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	const holds = [released.promise];

	async function sleepAsync(ms: number): Promise<void> {
		const hold = holds.pop();
		firstStarted.resolve();
		await hold;
		await clock.sleep(ms);
	}

	return { firstStarted: firstStarted.promise, release: released.resolve, sleep: sleepAsync };
}

function createControlledSleep(): {
	readonly firstStarted: Promise<void>;
	readonly resumeSecond: () => void;
	readonly secondStarted: Promise<void>;
	readonly signals: ReadonlyArray<AbortSignal | undefined>;
	readonly sleep: SleepFunc;
} {
	const firstStarted = Promise.withResolvers<void>();
	const secondStarted = Promise.withResolvers<void>();
	const secondFinished = Promise.withResolvers<void>();
	const signals: Array<AbortSignal | undefined> = [];
	const stages = [
		{ finished: new Promise<void>(() => {}), started: firstStarted },
		{ finished: secondFinished.promise, started: secondStarted },
	];
	let stageIndex = 0;

	async function sleepAsync(_ms: number, signal?: AbortSignal): Promise<void> {
		signals.push(signal);
		const stage = stages[stageIndex];
		assert(stage !== undefined);
		stageIndex += 1;
		stage.started.resolve();
		await stage.finished;
	}

	return {
		firstStarted: firstStarted.promise,
		resumeSecond: secondFinished.resolve,
		secondStarted: secondStarted.promise,
		signals,
		sleep: sleepAsync,
	};
}

describe(ResourceClient, () => {
	describe("caller cancellation", () => {
		it("should return a typed failure without sending when the signal is already aborted", async () => {
			expect.assertions(5);

			const reason = new Error("superseded");
			const signal = AbortSignal.abort(reason);
			const buildRequest = vi.fn<typeof TEST_GET_SPEC.buildRequest>(
				TEST_GET_SPEC.buildRequest,
			);
			const httpClient = createFakeHttpClient({ schemaValidation: "off" });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.executeAsync({
				options: { signal },
				parameters: { id: "1" },
				spec: { ...TEST_GET_SPEC, buildRequest },
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(RequestAbortedError);
			expect(result.err.message).toBe("Request was aborted");
			expect((result.err as RequestAbortedError).reason).toBe(reason);
			expect(buildRequest).not.toHaveBeenCalled();
			expect(httpClient.requests).toHaveLength(0);
		});

		it("should cancel a caller-supplied retry wait without sending another attempt", async () => {
			expect.assertions(5);

			const controller = new AbortController();
			const reason = new Error("winner chosen");
			const sleepStarted = Promise.withResolvers<void>();
			let receivedSignal: AbortSignal | undefined;
			async function sleepAsync(_ms: number, signal?: AbortSignal): Promise<void> {
				receivedSignal = signal;
				sleepStarted.resolve();
				await new Promise<void>(() => {});
			}

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 60 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: sleepAsync,
			});

			const request = client.executeAsync({
				options: { signal: controller.signal },
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});
			await sleepStarted.promise;
			controller.abort(reason);
			const outcome = await Promise.race([
				request,
				new Promise<"still-pending">((resolve) => {
					setTimeout(resolve, 25, "still-pending");
				}),
			]);

			expect(outcome).not.toBe("still-pending");

			assert(outcome !== "still-pending" && !outcome.success);

			expect(outcome.err).toBeInstanceOf(RequestAbortedError);
			expect(outcome.err).toMatchObject({ message: "Request was aborted", reason });
			expect(receivedSignal).toBe(controller.signal);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should pass cancellation to an in-flight transport and preserve the Result contract", async () => {
			expect.assertions(4);

			const requestStarted = Promise.withResolvers<void>();
			let transportSignal: AbortSignal | undefined;
			async function requestAsync(
				_request: HttpRequest,
				config: Parameters<HttpClient["request"]>[1],
			): ReturnType<HttpClient["request"]> {
				transportSignal = config.signal;
				requestStarted.resolve();
				await new Promise<void>(() => {});
				throw new Error("unreachable");
			}

			const httpClient: HttpClient = { request: requestAsync };
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});
			const controller = new AbortController();

			const request = client.executeAsync({
				options: { signal: controller.signal },
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});
			await requestStarted.promise;
			controller.abort("superseded");
			const outcome = await Promise.race([
				request,
				new Promise<"still-pending">((resolve) => {
					setTimeout(resolve, 25, "still-pending");
				}),
			]);

			expect(outcome).not.toBe("still-pending");

			assert(outcome !== "still-pending" && !outcome.success);

			expect(outcome.err).toBeInstanceOf(RequestAbortedError);
			expect((outcome.err as RequestAbortedError).reason).toBe("superseded");
			expect(transportSignal).toBe(controller.signal);
		});

		it("should skip a cancelled queued request without consuming the next caller's slot", async () => {
			expect.assertions(4);

			const firstRequestStarted = Promise.withResolvers<void>();
			const finishFirstRequest = Promise.withResolvers<void>();
			const controlledSleep = createControlledSleep();
			const sentUrls: Array<string> = [];
			const requestFinishes = [finishFirstRequest.promise, Promise.resolve()];
			let requestIndex = 0;
			async function requestAsync(request: HttpRequest): ReturnType<HttpClient["request"]> {
				sentUrls.push(request.url);
				const finished = requestFinishes[requestIndex];
				assert(finished !== undefined);
				requestIndex += 1;
				firstRequestStarted.resolve();
				await finished;
				return { data: { body: {}, headers: {}, status: 200 }, success: true };
			}

			const httpClient: HttpClient = { request: requestAsync };
			const slowSpec: ResourceMethodSpec<TestParameters, TestResult> = {
				...TEST_GET_SPEC,
				operationLimit: { burstCapacity: 1, maxPerSecond: 1, operationKey: "test.slow" },
			};
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: controlledSleep.sleep,
			});
			const controller = new AbortController();

			const first = client.executeAsync({ parameters: { id: "first" }, spec: slowSpec });
			await firstRequestStarted.promise;
			const cancelled = client.executeAsync({
				options: { signal: controller.signal },
				parameters: { id: "cancelled" },
				spec: slowSpec,
			});
			await controlledSleep.firstStarted;
			const next = client.executeAsync({ parameters: { id: "next" }, spec: slowSpec });
			controller.abort("lost race");

			const cancelledResult = await Promise.race([
				cancelled,
				new Promise<"still-pending">((resolve) => {
					setTimeout(resolve, 25, "still-pending");
				}),
			]);

			expect(cancelledResult).not.toBe("still-pending");

			assert(cancelledResult !== "still-pending" && !cancelledResult.success);

			expect(cancelledResult.err).toBeInstanceOf(RequestAbortedError);

			await controlledSleep.secondStarted;
			controlledSleep.resumeSecond();
			const nextResult = await next;
			finishFirstRequest.resolve();
			await first;

			assert(nextResult.success);

			expect(sentUrls).toStrictEqual(["/test/first", "/test/next"]);
			expect(controlledSleep.signals).toStrictEqual([controller.signal, undefined]);
		});

		it("should reject an unexpected queue failure rather than misclassifying cancellation", async () => {
			expect.assertions(1);

			const failure = new Error("scheduler failed");
			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				status: 200,
			});
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: async () => {
					throw failure;
				},
			});
			const slowSpec: ResourceMethodSpec<TestParameters, TestResult> = {
				...TEST_GET_SPEC,
				operationLimit: { burstCapacity: 1, maxPerSecond: 1, operationKey: "test.failure" },
			};

			await client.executeAsync({ parameters: { id: "first" }, spec: slowSpec });

			await expect(
				client.executeAsync({ parameters: { id: "second" }, spec: slowSpec }),
			).rejects.toBe(failure);
		});
	});

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

			const result = await client.executeAsync({
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

			await client.executeAsync({
				options: {
					apiKey: "override-key",
					baseUrl: "https://override.example",
					timeout: 1000,
				},
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			expect(httpClient.requests[0]!.config).toStrictEqual({
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

			await client.executeAsync({
				options: { apiKey: "override-key", timeout: 99 },
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});
			await client.executeAsync({ parameters: { id: "2" }, spec: TEST_GET_SPEC });

			expect(httpClient.requests[1]!.config).toStrictEqual({
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

			const result = await client.executeAsync({
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

			const result = await client.executeAsync({
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

			await client.executeAsync({ parameters: { id: "1" }, spec: TEST_UPLOAD_SPEC });

			expect(httpClient.requests[0]!.config).toStrictEqual({
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

			await client.executeAsync({
				options: { timeout: 1000 },
				parameters: { id: "1" },
				spec: TEST_UPLOAD_SPEC,
			});

			expect(httpClient.requests[0]!.config.timeout).toBe(1000);
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

			await client.executeAsync({ parameters: { id: "1" }, spec: TEST_CREATE_SPEC });

			expect(httpClient.requests[0]!.config.timeout).toBe(30_000);
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

			await spendBurstAsync(client);

			await client.executeAsync({
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
				await client.executeAsync({ parameters: { id: "x" }, spec: TEST_GET_SPEC });
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

			const result = await client.executeAsync({
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

			const result = await client.executeAsync({
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

			const result = await client.executeAsync({
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

			const result = await client.executeAsync({
				parameters: { id: "1" },
				spec: TEST_CREATE_SPEC,
			});

			assert(!result.success);

			expect(httpClient.requests).toHaveLength(1);
		});

		it("should retry a transient transport error for idempotent-kind specs", async () => {
			expect.assertions(1);

			const reset = new CodedError("read ECONNRESET", "ECONNRESET");
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockError(new NetworkError("Network request failed", { cause: reset }))
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.executeAsync({
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
		});

		it("should not retry a transport error for create-kind specs by default", async () => {
			expect.assertions(1);

			const reset = new CodedError("read ECONNRESET", "ECONNRESET");
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockError(new NetworkError("Network request failed", { cause: reset }))
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.executeAsync({
				parameters: { id: "1" },
				spec: TEST_CREATE_SPEC,
			});

			assert(!result.success);

			expect(httpClient.requests).toHaveLength(1);
		});

		it("should retry a transport error for create-kind specs when opted in per request", async () => {
			expect.assertions(1);

			const reset = new CodedError("read ECONNRESET", "ECONNRESET");
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockError(new NetworkError("Network request failed", { cause: reset }))
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.executeAsync({
				options: { retryableTransportCodes: ["ECONNRESET"] },
				parameters: { id: "1" },
				spec: TEST_CREATE_SPEC,
			});

			assert(result.success);

			expect(httpClient.requests).toHaveLength(2);
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

			const result = await client.executeAsync({
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

			const result = await client.executeAsync({
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err.statusCode).toBe(201);
		});
	});

	describe("permission upgrade", () => {
		it("should preserve a transport failure when the spec declares scopes", async () => {
			expect.assertions(1);

			const error = new NetworkError("offline");
			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(error);
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.executeAsync({
				parameters: { id: "1" },
				spec: { ...TEST_GET_SPEC, requiredScopes: ["test:read"] },
			});

			assert(!result.success);

			expect(result.err).toBe(error);
		});

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

			const result = await client.executeAsync({
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

			const result = await client.executeAsync({
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

		it("should leave a gateway rejection an ApiError rather than blaming the credential", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(
				new ApiError("HTTP 403", {
					gatewaySummary: "403 Forbidden",
					statusCode: 403,
				}),
			);
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.executeAsync({
				parameters: { id: "1" },
				spec: {
					...TEST_GET_SPEC,
					requiredScopes: ["test:read"],
				},
			});

			assert(!result.success);
			assert(result.err instanceof ApiError);

			expect(result.err).not.toBeInstanceOf(PermissionError);
			expect(result.err.gatewaySummary).toBe("403 Forbidden");
		});

		it("should preserve message, code, cause, and details from the original ApiError on upgrade", async () => {
			expect.assertions(5);

			const upstream = new Error("upstream-failure");
			const original = new ApiError("missing scope", {
				cause: upstream,
				code: "INSUFFICIENT_SCOPE",
				details: { message: "the api key lacks the required scope" },
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

			const result = await client.executeAsync({
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
			expect(result.err.details).toStrictEqual({
				message: "the api key lacks the required scope",
			});
			expect(result.err.name).toBe("PermissionError");
		});

		it("should preserve the transport request context from the original ApiError on upgrade", async () => {
			expect.assertions(3);

			const original = new ApiError("HTTP 403", {
				elapsedMs: 1234,
				method: "POST",
				statusCode: 403,
				url: "https://apis.roblox.com/cloud/v2/universes/1",
			});
			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockError(
				original,
			);
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.executeAsync({
				parameters: { id: "1" },
				spec: {
					...TEST_GET_SPEC,
					requiredScopes: ["test:read"],
				},
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.method).toBe("POST");
			expect(result.err.url).toBe("https://apis.roblox.com/cloud/v2/universes/1");
			expect(result.err.elapsedMs).toBe(1234);
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

			const result = await client.executeAsync({
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

			const result = await client.executeAsync({
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

			const result = await client.executeAsync({
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

			await client.executeAsync({ parameters: { id: "1" }, spec: TEST_GET_SPEC });

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

			await client.executeAsync({ parameters: { id: "1" }, spec: TEST_GET_SPEC });

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

			await client.executeAsync({ parameters: { id: "1" }, spec: TEST_GET_SPEC });

			expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(2000);
			expect(sleep.waits).toStrictEqual([2000]);
		});
	});

	describe("adaptive throttling", () => {
		it("should cancel a reported-budget wait without poisoning the next request", async () => {
			expect.assertions(4);

			const controlledSleep = createControlledSleep();
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockResponse({
					headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "60" },
					status: 200,
				})
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: controlledSleep.sleep,
			});
			const controller = new AbortController();

			await client.executeAsync({ parameters: { id: "first" }, spec: TEST_GET_SPEC });
			const cancelled = client.executeAsync({
				options: { signal: controller.signal },
				parameters: { id: "cancelled" },
				spec: TEST_GET_SPEC,
			});
			await controlledSleep.firstStarted;
			controller.abort("no longer needed");
			const cancelledResult = await Promise.race([
				cancelled,
				new Promise<"still-pending">((resolve) => {
					setTimeout(resolve, 25, "still-pending");
				}),
			]);

			expect(cancelledResult).not.toBe("still-pending");

			assert(cancelledResult !== "still-pending" && !cancelledResult.success);

			expect(cancelledResult.err).toBeInstanceOf(RequestAbortedError);

			const next = client.executeAsync({ parameters: { id: "next" }, spec: TEST_GET_SPEC });
			await controlledSleep.secondStarted;
			controlledSleep.resumeSecond();
			const nextResult = await next;
			assert(nextResult.success);

			expect(httpClient.requests.map(({ request }) => request.url)).toStrictEqual([
				"/test/first",
				"/test/next",
			]);
			expect(controlledSleep.signals).toStrictEqual([controller.signal, undefined]);
		});

		it("should hold the same operation when an earlier response reported zero remaining", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockResponse({
					headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "60" },
					status: 200,
				})
				.mockResponse({ status: 200 });
			const clock = createFakeClock();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			const first = await client.executeAsync({
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});
			const second = await client.executeAsync({
				parameters: { id: "2" },
				spec: TEST_GET_SPEC,
			});

			assert(first.success);
			assert(second.success);

			expect(clock.waits).toStrictEqual([60_000]);
		});

		it("should not hold a sibling operation on the key that reported zero remaining", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockResponse({
					headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "60" },
					status: 200,
				})
				.mockResponse({ status: 200 });
			const clock = createFakeClock();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			const first = await client.executeAsync({
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});
			const second = await client.executeAsync({
				parameters: { id: "2" },
				spec: TEST_CREATE_SPEC,
			});

			assert(first.success);
			assert(second.success);

			expect(clock.waits).toStrictEqual([]);
		});

		it("should not let a roomy operation erase an exhausted sibling's window", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockResponse({
					headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "60" },
					status: 200,
				})
				.mockResponse({
					headers: { "x-ratelimit-remaining": "199", "x-ratelimit-reset": "60" },
					status: 200,
				})
				.mockResponse({ status: 200 });
			const clock = createFakeClock();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await client.executeAsync({ parameters: { id: "1" }, spec: TEST_CREATE_SPEC });
			await client.executeAsync({ parameters: { id: "2" }, spec: TEST_GET_SPEC });
			await client.executeAsync({ parameters: { id: "3" }, spec: TEST_CREATE_SPEC });

			expect(clock.waits).toStrictEqual([60_000]);
		});

		it("should not hold when responses carry no rate-limit headers", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockResponse({ status: 200 })
				.mockResponse({ status: 200 });
			const clock = createFakeClock();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await client.executeAsync({ parameters: { id: "1" }, spec: TEST_GET_SPEC });
			await client.executeAsync({ parameters: { id: "2" }, spec: TEST_CREATE_SPEC });

			expect(clock.waits).toStrictEqual([]);
		});
	});

	describe("admission waits", () => {
		it("should report the start and end of a retry delay around its sleep", async () => {
			expect.assertions(2);

			const timeline: Array<AdmissionWait | string> = [];
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 2 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				async sleep(ms) {
					timeline.push(`sleep ${String(ms)}`);
				},
			});

			const result = await client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						timeline.push(wait);
					},
				},
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			expect(result.success).toBeTrue();
			expect(timeline).toStrictEqual([
				{ phase: "start", reason: "retry-delay", waitMs: 2000 },
				"sleep 2000",
				{ phase: "end", reason: "retry-delay", waitMs: 2000 },
			]);
		});

		it("should retry on schedule when the observer throws", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 2 })
				.mockResponse({ status: 200 });
			const sleep = createFakeSleep();
			const client = new ResourceClient({ apiKey: "test-key", httpClient, sleep });

			const result = await client.executeAsync({
				options: {
					onAdmissionWait() {
						throw new Error("observer failure");
					},
				},
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			expect(result.success).toBeTrue();
			expect(sleep.waits).toStrictEqual([2000]);
			expect(httpClient.requests).toHaveLength(2);
		});

		it("should report nothing for a request that is admitted without waiting", async () => {
			expect.assertions(2);

			const onAdmissionWait = vi.fn<(wait: AdmissionWait) => void>();
			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				status: 200,
			});
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.executeAsync({
				options: { onAdmissionWait },
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			expect(result.success).toBeTrue();
			expect(onAdmissionWait).not.toHaveBeenCalled();
		});

		it("should report the start and end of an operation-queue wait around its sleep", async () => {
			expect.assertions(2);

			const timeline: Array<AdmissionWait | string> = [];
			const httpClient = mockManyOk(createFakeHttpClient({ schemaValidation: "off" }), 11);
			const clock = createFakeClock();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				async sleep(ms) {
					timeline.push(`sleep ${String(ms)}`);
					await clock.sleep(ms);
				},
			});

			// The burst allowance is spent first, so only the call that follows
			// is held by the queue.
			await spendBurstAsync(client);

			const result = await client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						timeline.push(wait);
					},
				},
				parameters: { id: "x" },
				spec: TEST_GET_SPEC,
			});

			expect(result.success).toBeTrue();
			expect(timeline).toStrictEqual([
				{ phase: "start", reason: "operation-queue", waitMs: 100 },
				"sleep 100",
				{ phase: "end", reason: "operation-queue", waitMs: 100 },
			]);
		});

		it("should report the start and end of a reported-budget wait around its sleep", async () => {
			expect.assertions(2);

			const timeline: Array<AdmissionWait | string> = [];
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockResponse({
					headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "60" },
					status: 200,
				})
				.mockResponse({ status: 200 });
			const clock = createFakeClock();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				async sleep(ms) {
					timeline.push(`sleep ${String(ms)}`);
					await clock.sleep(ms);
				},
			});

			await client.executeAsync({ parameters: { id: "first" }, spec: TEST_GET_SPEC });
			const result = await client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						timeline.push(wait);
					},
				},
				parameters: { id: "second" },
				spec: TEST_GET_SPEC,
			});

			expect(result.success).toBeTrue();
			expect(timeline).toStrictEqual([
				{ phase: "start", reason: "reported-budget", waitMs: 60_000 },
				"sleep 60000",
				{ phase: "end", reason: "reported-budget", waitMs: 60_000 },
			]);
		});

		it("should report a queue wait without a duration while held behind another request", async () => {
			expect.assertions(1);

			const waits: Array<AdmissionWait> = [];
			const firstWait = Promise.withResolvers<void>();
			const httpClient = mockManyOk(createFakeHttpClient({ schemaValidation: "off" }), 12);
			const holdingSleep = createHoldingSleep(createFakeClock());
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: holdingSleep.sleep,
			});

			// The burst allowance is spent first, so the next call sleeps and
			// the one after it is held behind that sleep.
			await spendBurstAsync(client);

			const held = client.executeAsync({ parameters: { id: "holder" }, spec: TEST_GET_SPEC });
			await holdingSleep.firstStarted;
			const queued = client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						waits.push(wait);
						firstWait.resolve();
					},
				},
				parameters: { id: "queued" },
				spec: TEST_GET_SPEC,
			});

			// The queued request has reported its wait, so the holder still
			// sleeps: nothing here depends on how many awaits it took to get
			// there.
			await firstWait.promise;
			holdingSleep.release();
			await held;
			await queued;

			expect(waits).toStrictEqual([
				{ phase: "start", reason: "operation-queue" },
				{ phase: "end", reason: "operation-queue" },
			]);
		});

		it("should report a budget wait without a duration while held behind another request", async () => {
			expect.assertions(1);

			const waits: Array<AdmissionWait> = [];
			const firstWait = Promise.withResolvers<void>();
			const httpClient = mockManyOk(
				createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
					headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "60" },
					status: 200,
				}),
				2,
			);
			const holdingSleep = createHoldingSleep(createFakeClock());
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: holdingSleep.sleep,
			});

			// The first response reports the budget spent, so the next request
			// holds for the reported window and a third joins behind it.
			await client.executeAsync({ parameters: { id: "first" }, spec: TEST_GET_SPEC });
			const held = client.executeAsync({ parameters: { id: "holder" }, spec: TEST_GET_SPEC });
			await holdingSleep.firstStarted;
			const queued = client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						waits.push(wait);
						firstWait.resolve();
					},
				},
				parameters: { id: "queued" },
				spec: TEST_GET_SPEC,
			});
			// The queued request has reported its wait, so the holder still
			// sleeps: nothing here depends on how many awaits it took to get
			// there.
			await firstWait.promise;
			holdingSleep.release();
			await held;
			await queued;

			expect(waits).toStrictEqual([
				{ phase: "start", reason: "reported-budget" },
				{ phase: "end", reason: "reported-budget" },
			]);
		});

		it("should end a retry-delay wait exactly once when the caller cancels it", async () => {
			expect.assertions(2);

			const waits: Array<AdmissionWait> = [];
			const sleepStarted = Promise.withResolvers<void>();
			async function sleepAsync(): Promise<void> {
				sleepStarted.resolve();
				await new Promise<void>(() => {});
			}

			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 60 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: sleepAsync,
			});
			const controller = new AbortController();

			const request = client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						waits.push(wait);
					},
					signal: controller.signal,
				},
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});
			await sleepStarted.promise;
			controller.abort("no longer needed");
			const result = await request;

			expect(result.success).toBeFalse();
			expect(waits).toStrictEqual([
				{ phase: "start", reason: "retry-delay", waitMs: 60_000 },
				{ phase: "end", reason: "retry-delay", waitMs: 60_000 },
			]);
		});

		it("should end an operation-queue wait exactly once when the caller cancels it", async () => {
			expect.assertions(2);

			const waits: Array<AdmissionWait> = [];
			const sleepStarted = Promise.withResolvers<void>();
			async function sleepAsync(): Promise<void> {
				sleepStarted.resolve();
				await new Promise<void>(() => {});
			}

			const httpClient = mockManyOk(createFakeHttpClient({ schemaValidation: "off" }), 10);
			// Freeze the clock so the queue's computed wait is exact.
			createFakeClock();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: sleepAsync,
			});
			const controller = new AbortController();

			await spendBurstAsync(client);

			const request = client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						waits.push(wait);
					},
					signal: controller.signal,
				},
				parameters: { id: "cancelled" },
				spec: TEST_GET_SPEC,
			});
			await sleepStarted.promise;
			controller.abort("no longer needed");
			const result = await request;

			expect(result.success).toBeFalse();
			expect(waits).toStrictEqual([
				{ phase: "start", reason: "operation-queue", waitMs: 100 },
				{ phase: "end", reason: "operation-queue", waitMs: 100 },
			]);
		});

		it("should deliver each concurrent request only its own observations", async () => {
			expect.assertions(2);

			const holderWaits: Array<AdmissionWait> = [];
			const queuedWaits: Array<AdmissionWait> = [];
			const firstWait = Promise.withResolvers<void>();
			const httpClient = mockManyOk(createFakeHttpClient({ schemaValidation: "off" }), 12);
			const holdingSleep = createHoldingSleep(createFakeClock());
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: holdingSleep.sleep,
			});

			await spendBurstAsync(client);

			const held = client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						holderWaits.push(wait);
					},
				},
				parameters: { id: "holder" },
				spec: TEST_GET_SPEC,
			});
			await holdingSleep.firstStarted;
			const queued = client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						queuedWaits.push(wait);
						firstWait.resolve();
					},
				},
				parameters: { id: "queued" },
				spec: TEST_GET_SPEC,
			});
			// The queued request has reported its wait, so the holder still
			// sleeps: nothing here depends on how many awaits it took to get
			// there.
			await firstWait.promise;
			holdingSleep.release();
			await held;
			await queued;

			expect(holderWaits).toStrictEqual([
				{ phase: "start", reason: "operation-queue", waitMs: 100 },
				{ phase: "end", reason: "operation-queue", waitMs: 100 },
			]);
			expect(queuedWaits).toStrictEqual([
				{ phase: "start", reason: "operation-queue" },
				{ phase: "end", reason: "operation-queue" },
			]);
		});

		it("should report a queue wait for a request already queued when another starts sleeping", async () => {
			expect.assertions(2);

			const waits: Array<AdmissionWait> = [];
			const httpClient = mockManyOk(createFakeHttpClient({ schemaValidation: "off" }), 12);
			const clock = createFakeClock();
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			// The burst allowance is spent first, so the two calls that follow
			// are both queued before either one sleeps.
			await spendBurstAsync(client);

			const first = client.executeAsync({ parameters: { id: "first" }, spec: TEST_GET_SPEC });
			const second = client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						waits.push(wait);
					},
				},
				parameters: { id: "second" },
				spec: TEST_GET_SPEC,
			});
			await first;
			await second;

			expect(clock.waits).toStrictEqual([100, 100]);
			expect(waits).toStrictEqual([
				{ phase: "start", reason: "operation-queue" },
				{ phase: "end", reason: "operation-queue" },
			]);
		});

		it("should report one retry-delay wait per retry a request makes", async () => {
			expect.assertions(1);

			const waits: Array<AdmissionWait> = [];
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockRateLimit({ retryAfterSeconds: 1 })
				.mockRateLimit({ retryAfterSeconds: 2 })
				.mockResponse({ status: 200 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						waits.push(wait);
					},
				},
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			expect(waits).toStrictEqual([
				{ phase: "start", reason: "retry-delay", waitMs: 1000 },
				{ phase: "end", reason: "retry-delay", waitMs: 1000 },
				{ phase: "start", reason: "retry-delay", waitMs: 2000 },
				{ phase: "end", reason: "retry-delay", waitMs: 2000 },
			]);
		});

		it("should end a retry-delay wait when the request runs out of retries", async () => {
			expect.assertions(2);

			const waits: Array<AdmissionWait> = [];
			const httpClient = createFakeHttpClient({ schemaValidation: "off" })
				.mockApiError({ statusCode: 500 })
				.mockApiError({ statusCode: 500 });
			const client = new ResourceClient({
				apiKey: "test-key",
				httpClient,
				maxRetries: 1,
				sleep: createFakeSleep(),
			});

			const result = await client.executeAsync({
				options: {
					onAdmissionWait(wait) {
						waits.push(wait);
					},
				},
				parameters: { id: "1" },
				spec: TEST_GET_SPEC,
			});

			expect(result.success).toBeFalse();
			expect(waits).toStrictEqual([
				{ phase: "start", reason: "retry-delay", waitMs: 1000 },
				{ phase: "end", reason: "retry-delay", waitMs: 1000 },
			]);
		});
	});
});
