import { describe, expect, it } from "vitest";

import { UPDATE_OPERATION_LIMIT } from "./operations.ts";

describe("places update operation limit", () => {
	it("should cap the update endpoint at 100 requests per minute", () => {
		expect.assertions(1);

		expect(UPDATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "places.update",
		});
	});
});
