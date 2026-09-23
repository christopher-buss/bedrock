import { assert, describe, expect, it } from "vitest";

import { UniversesClient } from "#src/resources/universes/client";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

function createClient(httpClient: ReturnType<typeof createFakeHttpClient>): UniversesClient {
	return new UniversesClient({ apiKey: "test-key", httpClient, sleep: createFakeSleep() });
}

describe(UniversesClient, () => {
	describe("restartServers", () => {
		it("should POST an empty body to the universe's restartServers method", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });

			const result = await createClient(httpClient).restartServers({ universeId: "42" });

			assert(result.success);

			expect(result.data).toBeUndefined();

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("POST");
			expect(captured.request.url).toBe("/cloud/v2/universes/42:restartServers");
			expect(captured.request.body).toStrictEqual({});
		});

		it("should turn a bleed-off duration on and forward place and version selection", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });

			await createClient(httpClient).restartServers({
				bleedOffDurationMinutes: 10,
				closeAllVersions: true,
				placeIds: ["15098004467"],
				universeId: "42",
			});

			expect(httpClient.requests[0]!.request.body).toStrictEqual({
				bleedOffDurationMinutes: 10,
				bleedOffServers: true,
				closeAllVersions: true,
				placeIds: [15_098_004_467],
			});
		});
	});
});
