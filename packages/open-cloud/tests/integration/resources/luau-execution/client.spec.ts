import { LuauExecutionClient } from "#src/resources/luau-execution/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validLogPageBody } from "#tests/helpers/luau-execution-task-logs";
import { validInProgressTaskBody } from "#tests/helpers/luau-execution-tasks";
import { assert, describe, expect, it } from "vitest";

describe(LuauExecutionClient, () => {
	describe("tasks.submit at head", () => {
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
			expect(httpClient.requests[0]?.request.url).toBe(
				"/cloud/v2/universes/123/places/456/luau-execution-session-tasks",
			);
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
			expect(httpClient.requests[0]?.request.url).toBe(
				"/cloud/v2/universes/123/places/456/versions/789/luau-execution-session-tasks",
			);
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
			expect(httpClient.requests[0]?.request.url).toContain("/tasks/task-1/logs");
			expect(httpClient.requests[0]?.request.url).toContain("view=STRUCTURED");
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
			expect(httpClient.requests[0]?.request.url).toBe(
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

			expect(httpClient.requests[0]?.request.url).toEndWith("?view=FULL");
		});
	});
});
