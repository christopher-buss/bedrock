import { LuauExecutionClient } from "#src/resources/luau-execution/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
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
});
