import { assert, describe, it } from "vitest";

import { ApiError } from "#src/errors/api-error";
import { BadgeCostMismatchError } from "#src/errors/badge-cost-mismatch";
import { PermissionError } from "#src/errors/permission-error";
import { BadgesClient } from "#src/resources/badges/index";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";

const ICON_BYTES = new Uint8Array([1, 2, 3]);

const COST_MISMATCH_MESSAGE = "Expected badge cost is different from the actual badge cost.";

describe(BadgesClient, () => {
	describe("create", () => {
		it.for([403, 400])(
			"should return a cost mismatch, not a permission error, when a %i carries code 18",
			async (statusCode, { expect }) => {
				expect.assertions(3);

				const httpClient = createFakeHttpClient().mockApiError({
					code: "18",
					message: COST_MISMATCH_MESSAGE,
					statusCode,
				});
				const client = new BadgesClient({
					credential: { apiKey: "test-key", kind: "apiKey" },
					httpClient,
					sleep: createFakeSleep(),
				});

				const result = await client.create({
					name: "First Goal",
					expectedCost: 0,
					icon: ICON_BYTES,
					universeId: "999",
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(BadgeCostMismatchError);
				expect(result.err).toMatchObject({
					name: "BadgeCostMismatchError",
					code: "18",
					expectedCost: 0,
					message: COST_MISMATCH_MESSAGE,
					statusCode,
				});
				expect(result.err.cause).toBeInstanceOf(ApiError);
			},
		);

		it("should leave a 403 with another code a permission error", async ({ expect }) => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockApiError({ code: "17", statusCode: 403 });
			const client = new BadgesClient({
				credential: { apiKey: "test-key", kind: "apiKey" },
				httpClient,
				sleep: createFakeSleep(),
			});

			const result = await client.create({
				name: "First Goal",
				icon: ICON_BYTES,
				universeId: "999",
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(PermissionError);
		});
	});
});
