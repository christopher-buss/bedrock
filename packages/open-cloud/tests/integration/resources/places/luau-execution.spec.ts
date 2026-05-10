import { PlacesClient } from "#src/resources/places/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validLogPageBody } from "#tests/helpers/luau-execution-task-logs";
import { validInProgressTaskBody } from "#tests/helpers/luau-execution-tasks";
import { assert, describe, expect, it } from "vitest";

describe(PlacesClient, () => {
	describe("luauExecution.submit at head", () => {
		it("should POST to the head URL and parse the response", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody(),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "test-key",
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
			expect(httpClient.requests[0]?.request.url).toBe(
				"/cloud/v2/universes/123/places/456/luau-execution-session-tasks",
			);
		});
	});

	describe("luauExecution.submit at a specific version", () => {
		it("should POST to the version URL when versionId is supplied", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validInProgressTaskBody({
					path: "universes/123/places/456/versions/789/luau-execution-session-tasks/task-2",
				}),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "test-key",
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
			expect(httpClient.requests[0]?.request.url).toBe(
				"/cloud/v2/universes/123/places/456/versions/789/luau-execution-session-tasks",
			);
		});
	});

	describe("luauExecution.listLogs", () => {
		it("should GET the maximal /logs URL when called via PlacesClient and parse the response into a LogPage", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: validLogPageBody(),
				status: 200,
			});
			const client = new PlacesClient({
				apiKey: "test-key",
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
			expect(httpClient.requests[0]?.request.url).toContain("/tasks/task-1/logs");
			expect(httpClient.requests[0]?.request.url).toContain("view=STRUCTURED");
		});
	});

	describe("luauExecution.get", () => {
		it("should GET the maximal URL and parse the response", async () => {
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
				apiKey: "test-key",
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
			expect(httpClient.requests[0]?.request.url).toBe(
				"/cloud/v2/universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
			);
		});
	});
});
