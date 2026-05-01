import { describe, expect, it } from "vitest";

import { PUBLISH_OPERATION_LIMIT } from "./operations.ts";

describe("places publish operation limit", () => {
	it("should cap the publish/save endpoint at 0.5 requests per second (30/min)", () => {
		expect.assertions(1);

		expect(PUBLISH_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 0.5,
			operationKey: "places.publishVersion",
		});
	});
});
