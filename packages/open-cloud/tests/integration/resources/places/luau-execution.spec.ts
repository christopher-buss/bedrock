import { PlacesClient } from "#src/resources/places/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { validInProgressTaskBody } from "#tests/helpers/luau-execution-tasks";
import { assert, describe, expect, it } from "vitest";

describe("placesClient.luauExecution", () => {
	it("should POST to the head URL via submit and parse the response", async () => {
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

	it("should GET the maximal URL via get and parse the response", async () => {
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

describe("places-client luau-execution OG submit at a specific version", () => {
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
