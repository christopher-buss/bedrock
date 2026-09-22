import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import type { AdmissionWaitEvent } from "#src/client/types";
import {
	SUBMIT_HEAD_OPERATION_LIMIT,
	SUBMIT_VERSION_OPERATION_LIMIT,
} from "#src/domains/cloud-v2/luau-execution-tasks/operations";
import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { RateLimitError } from "#src/errors/rate-limit";
import { RequestAbortedError } from "#src/errors/request-aborted";
import { RequestDeadlineExceededError } from "#src/errors/request-deadline-exceeded";
import { RetryDelayExceededError } from "#src/errors/retry-delay-exceeded";
import { createFetchHttpClient } from "#src/internal/http/fetch-client";
import {
	LuauExecutionCapacityError,
	LuauExecutionClient,
} from "#src/resources/luau-execution/index";
import type { LuauExecutionTaskRef } from "#src/resources/luau-execution/index";
import { createFakeClock } from "#tests/helpers/fake-clock";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validBinaryInputBody } from "#tests/helpers/luau-execution-task-binary-inputs";
import { validLogPageBody } from "#tests/helpers/luau-execution-task-logs";
import { validInProgressTaskBody } from "#tests/helpers/luau-execution-tasks";

const fullRef: LuauExecutionTaskRef = {
	placeId: "456",
	sessionId: "session-1",
	taskId: "task-1",
	universeId: "123",
	versionId: "789",
};

const { burstCapacity: HEAD_BURST = 1 } = SUBMIT_HEAD_OPERATION_LIMIT;
const { burstCapacity: VERSION_BURST = 1, maxPerSecond: VERSION_PER_SECOND } =
	SUBMIT_VERSION_OPERATION_LIMIT;
const VERSION_INTERVAL_MS = 1000 / VERSION_PER_SECOND;

async function spendSubmitBurstAsync(
	client: LuauExecutionClient,
	{ count, versionId }: { count: number; versionId?: string },
): Promise<void> {
	for (let index = 0; index < count; index++) {
		await client.tasks.submit({
			placeId: "456",
			script: "return 1",
			universeId: "123",
			...(versionId === undefined ? {} : { versionId }),
		});
	}
}

const processingBody = validInProgressTaskBody({
	path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
	state: "PROCESSING",
});

const completeBody = validInProgressTaskBody({
	output: { results: [] },
	path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
	state: "COMPLETE",
});

const capacityBlockerRef: LuauExecutionTaskRef = {
	placeId: "456",
	sessionId: "11111111-1111-4111-8111-111111111111",
	taskId: "22222222-2222-4222-8222-222222222222",
	universeId: "123",
	versionId: "789",
};

const secondCapacityBlockerRef: LuauExecutionTaskRef = {
	...capacityBlockerRef,
	taskId: "33333333-3333-4333-8333-333333333333",
};

function capacityErrorFor(blockers: ReadonlyArray<LuauExecutionTaskRef>): RateLimitError {
	const paths = blockers.map(({ placeId, sessionId, taskId, universeId, versionId }) => {
		return `universes/${universeId}/places/${placeId}/versions/${versionId}/luau-execution-sessions/${sessionId}/tasks/${taskId}`;
	});
	return new RateLimitError("Rate limited", {
		code: "RESOURCE_EXHAUSTED",
		details: {
			code: "RESOURCE_EXHAUSTED",
			message: `Too many tasks already active: ${paths.join(", ")}`,
		},
		remaining: 3,
		retryAfterSeconds: 300,
		statusCode: 429,
	});
}

function abortOnCapacityWait(
	controller: AbortController,
	events: Array<AdmissionWaitEvent>,
): (event: AdmissionWaitEvent) => void {
	return (event) => {
		events.push(event);
		if (event.phase === "started") {
			controller.abort("superseded");
		}
	};
}

function capacityError(blocker: LuauExecutionTaskRef = capacityBlockerRef): RateLimitError {
	return capacityErrorFor([blocker]);
}

async function submitAfterRateLimitAsync({
	headers,
	repeatRateLimit = false,
	retryDelayMs = 99_000,
}: {
	readonly headers: Readonly<Record<string, string>>;
	readonly repeatRateLimit?: boolean;
	readonly retryDelayMs?: number;
}) {
	let requestCount = 0;
	async function fakeFetchAsync(): Promise<Response> {
		requestCount += 1;
		if (requestCount === 1 || repeatRateLimit) {
			return new Response('{"error":"RESOURCE_EXHAUSTED"}', {
				headers: { ...headers },
				status: 429,
			});
		}

		return new Response(JSON.stringify(validInProgressTaskBody()), { status: 200 });
	}

	const clock = createFakeClock();
	const client = new LuauExecutionClient({
		apiKey: "test-key",
		httpClient: createFetchHttpClient(fakeFetchAsync),
		maxRetries: 1,
		retryDelay: () => retryDelayMs,
		sleep: clock.sleep,
	});
	const result = await client.tasks.submit({
		placeId: "456",
		script: "return 1",
		universeId: "123",
	});
	return { result, waits: clock.waits };
}

describe(LuauExecutionClient, () => {
	describe("binaryInputs.create", () => {
		it("should POST to the universe-scoped URL and return path plus uploadUri", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validBinaryInputBody(),
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.binaryInputs.create({
				size: 1024,
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.path).toBe(
				"universes/123/luau-execution-session-task-binary-inputs/abc",
			);
			expect(result.data.uploadUri).toBe("https://storage.example.com/upload?token=xyz");
			expect(httpClient.requests[0]!.request.url).toBe(
				"/cloud/v2/universes/123/luau-execution-session-task-binary-inputs",
			);
		});

		it("should not retry a 5xx so a transient binary-input create failure does not leak quota", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 503 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.binaryInputs.create({
				size: 1024,
				universeId: "1",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should upgrade a 403 to a PermissionError carrying the required scopes", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 403 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.binaryInputs.create({
				size: 1024,
				universeId: "1",
			});

			assert(!result.success);
			assert(result.err instanceof PermissionError);

			expect(result.err.requiredScopes).toStrictEqual([
				"universe.place.luau-execution-session:write",
			]);
			expect(result.err.operationKey).toBe("luau-execution-task-binary-inputs.create");
			expect(result.err.statusCode).toBe(403);
		});
	});

	describe("tasks.submit at head", () => {
		it.for([NaN, Infinity, -1, 0, 0.5, 2_147_483_648])(
			"should not wait when the capacity bound is invalid: %s",
			async (capacityWaitMs) => {
				expect.assertions(3);

				const timerSpy = vi.spyOn(globalThis, "setTimeout");
				onTestFinished(() => {
					timerSpy.mockRestore();
				});
				const httpClient = createFakeHttpClient().mockError(capacityError());
				const client = new LuauExecutionClient({ apiKey: "test-key", httpClient });

				const result = await client.tasks.submit(
					{ placeId: "456", script: "return 1", universeId: "123" },
					{ capacityWaitMs },
				);

				assert(!result.success);

				expect(result.err).toBeInstanceOf(LuauExecutionCapacityError);
				expect(httpClient.requests).toHaveLength(1);
				expect(timerSpy).not.toHaveBeenCalled();
			},
		);

		it("should preserve caller cancellation while waiting for capacity", async () => {
			expect.assertions(4);

			const controller = new AbortController();
			const events = new Array<AdmissionWaitEvent>();
			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockResponse({ body: processingBody, status: 200 });
			const client = new LuauExecutionClient({ apiKey: "test-key", httpClient });

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{
					capacityWaitMs: 60_000,
					onAdmissionWait: abortOnCapacityWait(controller, events),
					signal: controller.signal,
				},
			);

			assert(!result.success);
			assert(result.err instanceof RequestAbortedError);

			expect(result.err.reason).toBe("superseded");
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
			]);
			expect(events).toStrictEqual([
				{ durationMs: 500, phase: "started", reason: "operation-capacity" },
				{ durationMs: 500, phase: "ended", reason: "operation-capacity" },
			]);
			expect(controller.signal.aborted).toBeTrue();
		});

		it("should stop admission when observing a blocker fails", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockApiError({ statusCode: 403 });
			const client = new LuauExecutionClient({ apiKey: "test-key", httpClient });

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ capacityWaitMs: 60_000 },
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(PermissionError);
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
			]);
		});

		it("should continue admission when a retry reports a new capacity blocker", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockResponse({ body: completeBody, status: 200 })
				.mockError(capacityError(secondCapacityBlockerRef))
				.mockResponse({ body: completeBody, status: 200 })
				.mockResponse({ body: validInProgressTaskBody(), status: 200 });
			const client = new LuauExecutionClient({ apiKey: "test-key", httpClient });

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ capacityWaitMs: 60_000 },
			);

			assert(result.success);

			expect(result.data.state).toBe("QUEUED");
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
				"POST",
				"GET",
				"POST",
			]);
		});

		it("should not treat an unchanged terminal blocker set as new progress", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockResponse({ body: completeBody, status: 200 })
				.mockError(capacityError());
			const client = new LuauExecutionClient({ apiKey: "test-key", httpClient });

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ capacityWaitMs: 60_000 },
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(LuauExecutionCapacityError);
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
				"POST",
			]);
		});

		it("should retry when any validated capacity blocker becomes terminal", async () => {
			expect.assertions(3);

			const sleep = createFakeSleep();
			const httpClient = createFakeHttpClient()
				.mockError(capacityErrorFor([capacityBlockerRef, secondCapacityBlockerRef]))
				.mockResponse({ body: processingBody, status: 200 })
				.mockResponse({ body: completeBody, status: 200 })
				.mockResponse({ body: validInProgressTaskBody(), status: 200 });
			const client = new LuauExecutionClient({ apiKey: "test-key", httpClient, sleep });

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ capacityWaitMs: 60_000 },
			);

			assert(result.success);

			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
				"GET",
				"POST",
			]);
			expect(httpClient.requests[2]!.request.url).toContain(secondCapacityBlockerRef.taskId);
			expect(sleep.waits).toStrictEqual([]);
		});

		it("should stop an in-flight blocker observation at the caller-selected capacity bound", async () => {
			expect.assertions(2);

			let requestCount = 0;
			let wasCapacityError = false;
			vi.useFakeTimers();
			try {
				const httpClient = createFakeHttpClient().mockError(capacityError());
				const send = httpClient.request.bind(httpClient);
				const request = vi
					.spyOn(httpClient, "request")
					.mockImplementationOnce(send)
					.mockImplementationOnce(async () => new Promise(() => {}));
				const client = new LuauExecutionClient({ apiKey: "test-key", httpClient });

				const pending = client.tasks.submit(
					{ placeId: "456", script: "return 1", universeId: "123" },
					{ capacityWaitMs: 1_000 },
				);
				await vi.advanceTimersByTimeAsync(1_000);
				const result = await pending;

				assert(!result.success);
				wasCapacityError = result.err instanceof LuauExecutionCapacityError;
				requestCount = request.mock.calls.length;
			} finally {
				vi.useRealTimers();
			}

			expect(wasCapacityError).toBeTrue();
			expect(requestCount).toBe(2);
		});

		it.for([
			{
				error: capacityError(),
				label: "capacity admission is not requested",
				options: undefined,
			},
			{
				error: new RateLimitError("Rate limited", {
					code: "RESOURCE_EXHAUSTED",
					details: { code: "RESOURCE_EXHAUSTED", message: "Request quota exhausted" },
					retryAfterSeconds: 60,
				}),
				label: "the response carries no blocker reference",
				options: { capacityWaitMs: 60_000 },
			},
			{
				error: capacityError({ ...capacityBlockerRef, placeId: "999" }),
				label: "the response names only a foreign blocker",
				options: { capacityWaitMs: 60_000 },
			},
		])("should preserve an ambiguous 429 when $label", async ({ error, options }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockError(error);
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				maxRetries: 0,
			});

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				options,
			);

			assert(!result.success);

			expect(result.err).toBe(error);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should expose only canonical validated blocker references on a capacity failure", async () => {
			expect.assertions(2);

			const first = capacityBlockerRef;
			const second = {
				...capacityBlockerRef,
				taskId: "33333333-3333-4333-8333-333333333333",
			};
			const foreign = { ...capacityBlockerRef, universeId: "999" };
			const paths = [second, foreign, first, second].map((ref) => {
				return `universes/${ref.universeId}/places/${ref.placeId}/versions/${ref.versionId}/luau-execution-sessions/${ref.sessionId}/tasks/${ref.taskId}`;
			});
			const httpClient = createFakeHttpClient().mockError(
				new RateLimitError("Rate limited", {
					code: "RESOURCE_EXHAUSTED",
					details: {
						code: "RESOURCE_EXHAUSTED",
						message: `${paths.join(", ")}, universes/123/places/456/versions/1/luau-execution-sessions/not-a-uuid/tasks/not-a-uuid`,
					},
					retryAfterSeconds: 5,
				}),
			);
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				maxRetries: 0,
			});

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ capacityWaitMs: 0 },
			);

			assert(!result.success);
			assert(result.err instanceof LuauExecutionCapacityError);

			expect(result.err.blockers).toStrictEqual([first, second]);
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should report capacity waits while polling blockers to a terminal state", async () => {
			expect.assertions(3);

			const events = new Array<AdmissionWaitEvent>();
			const sleep = createFakeSleep();
			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockResponse({
					body: validInProgressTaskBody({
						path: "universes/123/places/456/versions/789/luau-execution-sessions/11111111-1111-4111-8111-111111111111/tasks/22222222-2222-4222-8222-222222222222",
						state: "PROCESSING",
					}),
					status: 200,
				})
				.mockResponse({
					body: validInProgressTaskBody({
						output: { results: [] },
						path: "universes/123/places/456/versions/789/luau-execution-sessions/11111111-1111-4111-8111-111111111111/tasks/22222222-2222-4222-8222-222222222222",
						state: "COMPLETE",
					}),
					status: 200,
				})
				.mockResponse({ body: validInProgressTaskBody(), status: 200 });
			const client = new LuauExecutionClient({ apiKey: "test-key", httpClient, sleep });

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{
					capacityWaitMs: 60_000,
					onAdmissionWait: (event) => {
						events.push(event);
					},
				},
			);

			assert(result.success);

			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
				"GET",
				"POST",
			]);
			expect(sleep.waits).toStrictEqual([500]);
			expect(events).toStrictEqual([
				{ durationMs: 500, phase: "started", reason: "operation-capacity" },
				{ durationMs: 500, phase: "ended", reason: "operation-capacity" },
			]);
		});

		it("should observe a validated capacity blocker before retrying an opted-in submit", async () => {
			expect.assertions(5);

			const sleep = createFakeSleep();
			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockResponse({
					body: validInProgressTaskBody({
						output: { results: [] },
						path: "universes/123/places/456/versions/789/luau-execution-sessions/11111111-1111-4111-8111-111111111111/tasks/22222222-2222-4222-8222-222222222222",
						state: "COMPLETE",
					}),
					status: 200,
				})
				.mockResponse({ body: validInProgressTaskBody(), status: 200 });
			const client = new LuauExecutionClient({ apiKey: "test-key", httpClient, sleep });

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ apiKey: "request-key", capacityWaitMs: 60_000 },
			);

			assert(result.success);

			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
				"POST",
			]);
			expect(httpClient.requests[1]!.request.url).toBe(
				"/cloud/v2/universes/123/places/456/versions/789/luau-execution-sessions/11111111-1111-4111-8111-111111111111/tasks/22222222-2222-4222-8222-222222222222?view=BASIC",
			);
			expect(sleep.waits).toStrictEqual([]);
			expect(httpClient.requests[2]!.config.apiKey).toBe("request-key");
			expect(httpClient.requests[2]!.config.signal).toBeInstanceOf(AbortSignal);
		});

		it.for([
			{
				body: validInProgressTaskBody({ state: "CANCELLED" }),
				state: "CANCELLED",
			},
			{
				body: validInProgressTaskBody({
					error: { code: "SCRIPT_ERROR", message: "failed" },
					state: "FAILED",
				}),
				state: "FAILED",
			},
		])("should retry after a blocker reaches $state", async ({ body }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockResponse({ body, status: 200 })
				.mockResponse({ body: validInProgressTaskBody(), status: 200 });
			const client = new LuauExecutionClient({ apiKey: "test-key", httpClient });

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ capacityWaitMs: 60_000 },
			);

			assert(result.success);

			expect(result.data.state).toBe("QUEUED");
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
				"POST",
			]);
		});

		it("should shorten the final capacity sleep to the remaining bound", async () => {
			expect.assertions(3);

			const clock = createFakeClock();
			clock.advance(100);
			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockResponse({ body: processingBody, status: 200 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ capacityWaitMs: 250 },
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(LuauExecutionCapacityError);
			expect(clock.waits).toStrictEqual([250]);
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
			]);
		});

		it.for([1, 2_147_483_647])(
			"should clear the capacity deadline after admission completes at a valid %s ms bound",
			async (capacityWaitMs) => {
				expect.assertions(2);

				let remainingTimers = -1;
				vi.useFakeTimers();
				try {
					const httpClient = createFakeHttpClient()
						.mockError(capacityError())
						.mockResponse({ body: completeBody, status: 200 })
						.mockResponse({ body: validInProgressTaskBody(), status: 200 });
					const client = new LuauExecutionClient({ apiKey: "test-key", httpClient });

					const result = await client.tasks.submit(
						{ placeId: "456", script: "return 1", universeId: "123" },
						{ capacityWaitMs },
					);

					assert(result.success);

					expect(result.data.state).toBe("QUEUED");

					remainingTimers = vi.getTimerCount();
				} finally {
					vi.useRealTimers();
				}

				expect(remainingTimers).toBe(0);
			},
		);

		it("should POST to the head URL and parse the response into an in-progress task", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody(),
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.submit({
				placeId: "456",
				script: "return 1",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.state).toBe("QUEUED");
			expect(result.data.ref.taskId).toBe("task-1");
			expect(httpClient.requests[0]!.request.url).toBe(
				"/cloud/v2/universes/123/places/456/luau-execution-session-tasks",
			);
		});

		it("should follow Retry-After instead of an unrelated quota reset when capacity is occupied", async () => {
			expect.assertions(2);

			const { result, waits } = await submitAfterRateLimitAsync({
				headers: {
					"retry-after": "5",
					"x-ratelimit-remaining": "3",
					"x-ratelimit-reset": "22",
				},
			});

			assert(result.success);

			expect(result.data.state).toBe("QUEUED");
			expect(waits).toStrictEqual([5000]);
		});

		it("should refuse a server retry delay beyond the request deadline", async () => {
			expect.assertions(5);

			let requestCount = 0;
			async function fakeFetchAsync(): Promise<Response> {
				requestCount += 1;
				return new Response('{"code":"RESOURCE_EXHAUSTED"}', {
					headers: { "retry-after": "1856" },
					status: 429,
				});
			}

			const sleep = createFakeSleep();
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient: createFetchHttpClient(fakeFetchAsync),
				sleep,
			});
			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ deadlineMs: Date.now() + 495_000 },
			);

			assert(!result.success);
			assert(result.err instanceof RetryDelayExceededError);

			expect(result.err.remainingMs).toBeGreaterThanOrEqual(494_000);
			expect(result.err.remainingMs).toBeLessThanOrEqual(495_000);
			expect(result.err.retryAfterMs).toBe(1_856_000);
			expect(result.err.retryAfterSeconds).toBe(1856);
			expect({ requestCount, waits: sleep.waits }).toStrictEqual({
				requestCount: 1,
				waits: [],
			});
		});

		it("should accept a far-future absolute request deadline", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody(),
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.submit(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ deadlineMs: Number.MAX_SAFE_INTEGER },
			);

			assert(result.success);

			expect(result.data.state).toBe("QUEUED");
			expect(httpClient.requests).toHaveLength(1);
		});

		it.for([NaN, Infinity])(
			"should return a typed failure for non-finite request deadline %s",
			async (deadlineMs) => {
				expect.assertions(2);

				const httpClient = createFakeHttpClient().mockResponse({
					body: validInProgressTaskBody(),
					status: 200,
				});
				const client = new LuauExecutionClient({
					apiKey: "test-key",
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.tasks.submit(
					{ placeId: "456", script: "return 1", universeId: "123" },
					{ deadlineMs },
				);

				assert(!result.success);

				expect(result.err).toBeInstanceOf(RequestDeadlineExceededError);
				expect(httpClient.requests).toHaveLength(0);
			},
		);

		it("should follow an HTTP-date Retry-After value", async () => {
			expect.assertions(1);

			const { waits } = await submitAfterRateLimitAsync({
				headers: {
					"retry-after": "Thu, 01 Jan 1970 00:00:07 GMT",
					"x-ratelimit-remaining": "3",
					"x-ratelimit-reset": "22",
				},
			});

			expect(waits).toStrictEqual([7000]);
		});

		it("should retry immediately when Retry-After is zero", async () => {
			expect.assertions(1);

			const { waits } = await submitAfterRateLimitAsync({
				headers: {
					"retry-after": "0",
					"x-ratelimit-remaining": "3",
					"x-ratelimit-reset": "22",
				},
			});

			expect(waits).toStrictEqual([0]);
		});

		it("should wait for a later quota reset when the request quota is exhausted", async () => {
			expect.assertions(2);

			const { result, waits } = await submitAfterRateLimitAsync({
				headers: {
					"retry-after": "5",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": "22",
				},
				repeatRateLimit: true,
			});

			assert(!result.success);
			assert(result.err instanceof RateLimitError);

			expect(waits).toStrictEqual([22_000]);
			expect(result.err.retryAfterSeconds).toBe(22);
		});

		it.for([
			{
				headers: { "x-ratelimit-remaining": "3", "x-ratelimit-reset": "22" },
				kind: "missing",
			},
			{
				headers: {
					"retry-after": "not-a-delay",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": "not-a-reset",
				},
				kind: "invalid",
			},
			{
				headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "-3" },
				kind: "negative",
			},
			{
				headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "22.5" },
				kind: "fractional",
			},
			{
				headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1e2" },
				kind: "scientific notation",
			},
			{
				headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "0x10" },
				kind: "hexadecimal",
			},
			{
				headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "+3" },
				kind: "explicitly signed",
			},
			{
				headers: { "x-ratelimit-remaining": "-1", "x-ratelimit-reset": "22" },
				kind: "invalid remaining quota",
			},
		])("should use caller backoff when retry guidance is $kind", async ({ headers }) => {
			expect.assertions(1);

			const { waits } = await submitAfterRateLimitAsync({
				headers,
				retryDelayMs: 7000,
			});

			expect(waits).toStrictEqual([7000]);
		});
	});

	describe("tasks.submit at a specific version", () => {
		it("should POST to the version URL when versionId is supplied", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody({
					path: "universes/123/places/456/versions/789/luau-execution-session-tasks/task-2",
				}),
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.submit({
				placeId: "456",
				script: "return 1",
				universeId: "123",
				versionId: "789",
			});

			assert(result.success);

			expect(result.data.ref.versionId).toBe("789");
			expect(httpClient.requests[0]!.request.url).toBe(
				"/cloud/v2/universes/123/places/456/versions/789/luau-execution-session-tasks",
			);
		});
	});

	describe("tasks.submit rate-limit pacing", () => {
		it("should pace version-pinned submits from their own quota once their burst is spent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient();
			for (let index = 0; index <= VERSION_BURST; index++) {
				httpClient.mockResponse({ body: validInProgressTaskBody(), status: 200 });
			}

			const clock = createFakeClock();
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await spendSubmitBurstAsync(client, { count: VERSION_BURST + 1, versionId: "789" });

			expect(httpClient.requests).toHaveLength(VERSION_BURST + 1);
			expect(clock.waits).toStrictEqual([VERSION_INTERVAL_MS]);
		});

		it("should let a version-pinned submit send without waiting once the head burst is spent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient();
			for (let index = 0; index <= HEAD_BURST; index++) {
				httpClient.mockResponse({ body: validInProgressTaskBody(), status: 200 });
			}

			const clock = createFakeClock();
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: clock.sleep,
			});

			await spendSubmitBurstAsync(client, { count: HEAD_BURST });
			await spendSubmitBurstAsync(client, { count: 1, versionId: "789" });

			expect(httpClient.requests).toHaveLength(HEAD_BURST + 1);
			expect(clock.waits).toStrictEqual([]);
		});
	});

	describe("tasks.listLogs", () => {
		it("should GET the maximal /logs URL with view=STRUCTURED and parse the response into a LogPage", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validLogPageBody(),
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.listLogs({
				ref: {
					placeId: "456",
					sessionId: "session-1",
					taskId: "task-1",
					universeId: "123",
					versionId: "789",
				},
			});

			assert(result.success);

			expect(result.data.messages).toHaveLength(1);
			expect(httpClient.requests[0]!.request.url).toContain("/tasks/task-1/logs");
			expect(httpClient.requests[0]!.request.url).toContain("view=STRUCTURED");
		});
	});

	describe("tasks.get", () => {
		it("should GET the maximal URL and parse the response into a task", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody({
					path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
					state: "PROCESSING",
				}),
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.get({
				ref: {
					placeId: "456",
					sessionId: "session-1",
					taskId: "task-1",
					universeId: "123",
					versionId: "789",
				},
			});

			assert(result.success);

			expect(result.data.state).toBe("PROCESSING");
			expect(httpClient.requests[0]!.request.url).toBe(
				"/cloud/v2/universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
			);
		});

		it("should append ?view=FULL when view is FULL", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody({
					path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
				}),
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.tasks.get({
				ref: {
					placeId: "456",
					sessionId: "session-1",
					taskId: "task-1",
					universeId: "123",
					versionId: "789",
				},
				view: "FULL",
			});

			expect(httpClient.requests[0]!.request.url).toEndWith("?view=FULL");
		});
	});

	describe("binaryInputs.create path -> tasks.submit round-trip", () => {
		it("should thread the binaryInput resource path from create into a submit body", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockResponse({ body: validBinaryInputBody(), status: 200 })
				.mockResponse({ body: validInProgressTaskBody(), status: 200 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const creationResult = await client.binaryInputs.create({
				size: 1024,
				universeId: "123",
			});

			assert(creationResult.success);

			const submitResult = await client.tasks.submit({
				binaryInput: creationResult.data.path,
				placeId: "456",
				script: "return 1",
				universeId: "123",
			});

			assert(submitResult.success);

			expect(submitResult.data.state).toBe("QUEUED");
			expect(httpClient.requests[1]!.request.body).toStrictEqual({
				binaryInput: "universes/123/luau-execution-session-task-binary-inputs/abc",
				script: "return 1",
			});
		});
	});

	describe("tasks.runUntilDone", () => {
		it("should apply capacity admission before polling the submitted task", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockResponse({ body: completeBody, status: 200 })
				.mockResponse({
					body: validInProgressTaskBody({
						path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
						state: "QUEUED",
					}),
					status: 200,
				})
				.mockResponse({ body: completeBody, status: 200 });
			const client = new LuauExecutionClient({ apiKey: "test-key", httpClient });

			const result = await client.tasks.runUntilDone(
				{ placeId: "456", script: "return 1", universeId: "123", versionId: "789" },
				{ capacityWaitMs: 60_000, pollDelay: () => 0 },
			);

			assert(result.success);

			expect(result.data.state).toBe("COMPLETE");
			expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"POST",
				"GET",
				"POST",
				"GET",
			]);
		});

		it("should submit the task and then poll until the result reaches a terminal state", async () => {
			expect.assertions(2);

			const submitBody = validInProgressTaskBody({
				path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
				state: "QUEUED",
			});
			const httpClient = createFakeHttpClient()
				.mockResponse({ body: submitBody, status: 200 })
				.mockResponse({ body: processingBody, status: 200 })
				.mockResponse({ body: completeBody, status: 200 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.runUntilDone(
				{ placeId: "456", script: "return 1", universeId: "123", versionId: "789" },
				{ pollDelay: () => 0 },
			);

			assert(result.success);

			expect(result.data.state).toBe("COMPLETE");
			expect(httpClient.requests).toHaveLength(3);
		});

		it("should return the submit error without polling when submit fails", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockApiError({ statusCode: 400 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.runUntilDone(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ pollDelay: () => 0 },
			);

			expect(result.success).toBeFalse();
			expect(httpClient.requests).toHaveLength(1);
		});

		it("should derive the submit and poll request timeouts from the poll budget", async () => {
			expect.assertions(2);

			const submitBody = validInProgressTaskBody({
				path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
				state: "QUEUED",
			});
			const httpClient = createFakeHttpClient()
				.mockResponse({ body: submitBody, status: 200 })
				.mockResponse({ body: completeBody, status: 200 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.tasks.runUntilDone(
				{ placeId: "456", script: "return 1", universeId: "123", versionId: "789" },
				{ pollDelay: () => 0, timeoutMs: 120_000 },
			);

			expect(httpClient.requests[0]!.config.timeout).toBe(120_000);
			expect(httpClient.requests[1]!.config.timeout).toBe(120_000);
		});
	});

	describe("tasks.pollUntilDone", () => {
		it("should poll tasks.get until the response is COMPLETE", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockResponse({ body: processingBody, status: 200 })
				.mockResponse({ body: processingBody, status: 200 })
				.mockResponse({ body: completeBody, status: 200 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.pollUntilDone(fullRef, { pollDelay: () => 0 });

			assert(result.success);

			expect(result.data.state).toBe("COMPLETE");
			expect(httpClient.requests).toHaveLength(3);
		});

		// Slice 19: per-request apiKey flows through to polling fetch
		it("should forward per-request apiKey override to the underlying tasks.get", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: completeBody,
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "default-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.tasks.pollUntilDone(fullRef, {
				apiKey: "override-key",
				pollDelay: () => 0,
			});

			expect(httpClient.requests[0]!.config.apiKey).toBe("override-key");
		});

		// Slice 20: 429 burst during polling is absorbed by rate-limit retry
		it("should absorb a 429 burst during polling without surfacing it through the polling result", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient()
				.mockRateLimit({ retryAfterSeconds: 0 })
				.mockResponse({ body: processingBody, status: 200 })
				.mockResponse({ body: completeBody, status: 200 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.pollUntilDone(fullRef, { pollDelay: () => 0 });

			assert(result.success);

			expect(result.data.state).toBe("COMPLETE");
		});

		// A poll GET carries the task result envelope, the largest body in a
		// run; when the edge delivers it short the parse fails on a 200, which
		// no status allow-list can recover. One re-read fixes it.
		it("should re-read a poll response whose body arrived truncated", async () => {
			expect.assertions(2);

			const truncated = new ApiError(
				"Failed to parse response body (content-type: application/json, 1572740 chars read)",
				{ statusCode: 200, unparsedBodyLength: 1_572_740 },
			);
			const httpClient = createFakeHttpClient()
				.mockError(truncated)
				.mockResponse({ body: completeBody, status: 200 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.tasks.pollUntilDone(fullRef, { pollDelay: () => 0 });

			assert(result.success);

			expect(result.data.state).toBe("COMPLETE");
			expect(httpClient.requests).toHaveLength(2);
		});

		it("should derive the poll request timeout from the poll budget", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: completeBody,
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.tasks.pollUntilDone(fullRef, { pollDelay: () => 0, timeoutMs: 120_000 });

			expect(httpClient.requests[0]!.config.timeout).toBe(120_000);
		});

		it("should forward an explicit per-request timeout ahead of the poll budget", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: completeBody,
				status: 200,
			});
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.tasks.pollUntilDone(fullRef, {
				pollDelay: () => 0,
				timeout: 5_000,
				timeoutMs: 120_000,
			});

			expect(httpClient.requests[0]!.config.timeout).toBe(5_000);
		});

		// Slice 17: always requests view=BASIC
		it("should request view=BASIC on every polling iteration", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient()
				.mockResponse({ body: processingBody, status: 200 })
				.mockResponse({ body: processingBody, status: 200 })
				.mockResponse({ body: completeBody, status: 200 });
			const client = new LuauExecutionClient({
				apiKey: "test-key",
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.tasks.pollUntilDone(fullRef, { pollDelay: () => 0 });

			expect(httpClient.requests[0]!.request.url).toEndWith("?view=BASIC");
			expect(httpClient.requests[1]!.request.url).toEndWith("?view=BASIC");
			expect(httpClient.requests[2]!.request.url).toEndWith("?view=BASIC");
		});
	});
});
