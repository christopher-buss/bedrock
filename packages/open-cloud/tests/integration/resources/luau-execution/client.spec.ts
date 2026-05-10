import { ApiError } from "#src/errors/api-error";
import { PermissionError } from "#src/errors/permission-error";
import { LuauExecutionClient } from "#src/resources/luau-execution/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validBinaryInputBody } from "#tests/helpers/luau-execution-task-binary-inputs";
import { validInProgressTaskBody } from "#tests/helpers/luau-execution-tasks";
import { assert, describe, expect, it } from "vitest";

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
			expect(httpClient.requests[0]?.request.url).toBe(
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

			const createResult = await client.binaryInputs.create({
				size: 1024,
				universeId: "123",
			});

			assert(createResult.success);

			const submitResult = await client.tasks.submit({
				binaryInput: createResult.data.path,
				placeId: "456",
				script: "return 1",
				universeId: "123",
			});

			assert(submitResult.success);

			expect(submitResult.data.state).toBe("QUEUED");
			expect(httpClient.requests[1]?.request.body).toStrictEqual({
				binaryInput: "universes/123/luau-execution-session-task-binary-inputs/abc",
				script: "return 1",
			});
		});
	});
});
