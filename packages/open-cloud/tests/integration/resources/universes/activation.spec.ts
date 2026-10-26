import { describe, it } from "vitest";

import { UniversesClient } from "#src/resources/universes/client";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

describe("universe activation", () => {
	it.for(["activate", "deactivate"] as const)(
		"should %s an experience with an API key",
		async (operation, { expect }) => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
			const client = new UniversesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});
			const result = await client[operation]({ universeId: "42" });

			expect(result).toStrictEqual({ data: undefined, success: true });
			expect(httpClient.requests[0]!.request).toStrictEqual({
				method: "POST",
				url: `/legacy-develop/v1/universes/42/${operation}`,
			});
			expect(httpClient.requests[0]!.config.credential).toStrictEqual({
				apiKey: "test-key",
				kind: "apiKey",
			});
		},
	);
});
