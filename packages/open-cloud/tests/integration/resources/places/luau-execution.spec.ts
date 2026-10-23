import { assert, describe, it, vi } from "vitest";

import { createFetchHttpClient } from "#src/client/fetch-http-client";
import { PollTimeoutError } from "#src/errors/poll-timeout";
import { RateLimitError } from "#src/errors/rate-limit";
import { RequestDeadlineExceededError } from "#src/errors/request-deadline-exceeded";
import type { LuauExecutionTaskRef } from "#src/resources/luau-execution/index";
import { PlacesClient } from "#src/resources/places/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validLogPageBody } from "#tests/helpers/luau-execution-task-logs";
import { validInProgressTaskBody } from "#tests/helpers/luau-execution-tasks";

const fullRef: LuauExecutionTaskRef = {
	placeId: "456",
	sessionId: "session-1",
	taskId: "task-1",
	universeId: "123",
	versionId: "789",
};

const processingBody = validInProgressTaskBody({
	path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
	state: "PROCESSING",
});

const completeBody = validInProgressTaskBody({
	output: { results: [] },
	path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
	state: "COMPLETE",
});

function capacityError(): RateLimitError {
	return new RateLimitError("Rate limited", {
		code: "RESOURCE_EXHAUSTED",
		details: {
			code: "RESOURCE_EXHAUSTED",
			message:
				"Too many tasks already active: universes/123/places/456/versions/789/luau-execution-sessions/11111111-1111-4111-8111-111111111111/tasks/22222222-2222-4222-8222-222222222222",
		},
		retryAfterSeconds: 300,
	});
}

/**
 * A places client on the real fetch transport, answering each request with
 * the next body in turn.
 *
 * @param bodies - The JSON body of each response, in order.
 * @returns A client that sends every request through `createFetchHttpClient`.
 */
function fetchBackedClient(...bodies: ReadonlyArray<unknown>): PlacesClient {
	const responses = bodies.values();
	return new PlacesClient({
		credential: { apiKey: "test-key", kind: "apiKey" },
		httpClient: createFetchHttpClient({
			fetch: async () => Response.json(responses.next().value),
		}),
		sleep: createFakeSleep(),
	});
}

describe(PlacesClient, () => {
	describe("luauExecution.submit at head", () => {
		it("should admit capacity-aware submissions through the places surface", async ({
			expect,
		}) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockError(capacityError())
				.mockResponse({ body: completeBody, status: 200 })
				.mockResponse({ body: validInProgressTaskBody(), status: 200 });
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
			});

			const result = await client.luauExecution.submit(
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

		it("should POST to the head URL and parse the response", async ({ expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody(),
				status: 200,
			});
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.luauExecution.submit({
				placeId: "456",
				script: "return 1",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.state).toBe("QUEUED");
			expect(httpClient.requests[0]!.request.url).toBe(
				"/cloud/v2/universes/123/places/456/luau-execution-session-tasks",
			);
		});
	});

	describe("luauExecution.submit at a specific version", () => {
		it("should POST to the version URL when versionId is supplied", async ({ expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody({
					path: "universes/123/places/456/versions/789/luau-execution-session-tasks/task-2",
				}),
				status: 200,
			});
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.luauExecution.submit({
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

	describe("luauExecution.listLogs", () => {
		it("should GET the maximal /logs URL when called via PlacesClient and parse the response into a LogPage", async ({
			expect,
		}) => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validLogPageBody(),
				status: 200,
			});
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.luauExecution.listLogs({
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

	describe("luauExecution.get", () => {
		it("should GET the maximal URL and parse the response", async ({ expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody({
					output: { results: ["ok"] },
					path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
					state: "COMPLETE",
				}),
				status: 200,
			});
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.luauExecution.get({
				ref: {
					placeId: "456",
					sessionId: "session-1",
					taskId: "task-1",
					universeId: "123",
					versionId: "789",
				},
			});

			assert(result.success);

			expect(result.data.state).toBe("COMPLETE");
			expect(httpClient.requests[0]!.request.url).toBe(
				"/cloud/v2/universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
			);
		});
	});

	describe("luauExecution.runUntilDone", () => {
		it("should finish on the real transport with an infinite poll budget", async ({
			expect,
		}) => {
			expect.assertions(1);

			const client = fetchBackedClient(processingBody, completeBody);

			const result = await client.luauExecution.runUntilDone(
				{ placeId: "456", script: "return 1", universeId: "123", versionId: "789" },
				{ pollDelay: () => 0, timeoutMs: Infinity },
			);

			expect(result).toMatchObject({ data: { state: "COMPLETE" }, success: true });
		});

		// Slice 23: smoke test on places surface
		it("should compose submit and poll on placesClient.luauExecution", async ({ expect }) => {
			expect.assertions(2);

			const submitBody = validInProgressTaskBody({
				path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
				state: "QUEUED",
			});
			const httpClient = createFakeHttpClient()
				.mockResponse({ body: submitBody, status: 200 })
				.mockResponse({ body: completeBody, status: 200 });
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.luauExecution.runUntilDone(
				{ placeId: "456", script: "return 1", universeId: "123", versionId: "789" },
				{ pollDelay: () => 0 },
			);

			assert(result.success);

			expect(result.data.state).toBe("COMPLETE");
			expect(httpClient.requests).toHaveLength(2);
		});

		it("should resolve with PollTimeoutError when the submit outlives the budget", async ({
			expect,
		}) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient();
			vi.spyOn(httpClient, "request").mockImplementationOnce(
				async () => new Promise(() => {}),
			);
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
			});

			const result = await client.luauExecution.runUntilDone(
				{ placeId: "456", script: "return 1", universeId: "123" },
				{ timeoutMs: 20 },
			);

			assert(!result.success);
			assert(result.err instanceof PollTimeoutError);

			expect(result.err.timeoutMs).toBe(20);
			expect(result.err.cause).toBeInstanceOf(RequestDeadlineExceededError);
		});

		it("should derive the submit and poll request timeouts from the poll budget", async ({
			expect,
		}) => {
			expect.assertions(2);

			const submitBody = validInProgressTaskBody({
				path: "universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
				state: "QUEUED",
			});
			const httpClient = createFakeHttpClient()
				.mockResponse({ body: submitBody, status: 200 })
				.mockResponse({ body: completeBody, status: 200 });
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.luauExecution.runUntilDone(
				{ placeId: "456", script: "return 1", universeId: "123", versionId: "789" },
				{ pollDelay: () => 0, timeoutMs: 120_000 },
			);

			expect(httpClient.requests[0]!.config.timeout).toBe(120_000);
			expect(httpClient.requests[1]!.config.timeout).toBe(120_000);
		});
	});

	describe("luauExecution.pollUntilDone", () => {
		it("should finish on the real transport with an infinite poll budget", async ({
			expect,
		}) => {
			expect.assertions(1);

			const client = fetchBackedClient(completeBody);

			const result = await client.luauExecution.pollUntilDone(fullRef, {
				pollDelay: () => 0,
				timeoutMs: Infinity,
			});

			expect(result).toMatchObject({ data: { state: "COMPLETE" }, success: true });
		});

		// Slice 18: smoke test on places surface
		it("should poll luauExecution.get until the response is COMPLETE", async ({ expect }) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockResponse({ body: processingBody, status: 200 })
				.mockResponse({ body: completeBody, status: 200 });
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.luauExecution.pollUntilDone(fullRef, {
				pollDelay: () => 0,
			});

			assert(result.success);

			expect(result.data.state).toBe("COMPLETE");
			expect(httpClient.requests).toHaveLength(2);
		});

		it("should derive the poll request timeout from the poll budget", async ({ expect }) => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: completeBody,
				status: 200,
			});
			const client = new PlacesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			await client.luauExecution.pollUntilDone(fullRef, {
				pollDelay: () => 0,
				timeoutMs: 120_000,
			});

			expect(httpClient.requests[0]!.config.timeout).toBe(120_000);
		});
	});
});
