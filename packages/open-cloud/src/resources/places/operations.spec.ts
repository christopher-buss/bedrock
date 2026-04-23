import { describe, expect, it } from "vitest";

import { PUBLISH_OPERATION_LIMIT, UPDATE_OPERATION_LIMIT } from "./operations.ts";

describe("places operation limits", () => {
	it("should cap the publish/save endpoint at 0.5 requests per second (30/min)", () => {
		expect.assertions(1);

		expect(PUBLISH_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 0.5,
			operationKey: "places.publishVersion",
		});
	});

	it("should cap the update endpoint at 100 requests per minute", () => {
		expect.assertions(1);

		expect(UPDATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "places.update",
		});
	});

	it("should key publish and update independently so they do not share a queue", () => {
		expect.assertions(1);

		expect(PUBLISH_OPERATION_LIMIT.operationKey).not.toBe(UPDATE_OPERATION_LIMIT.operationKey);
	});
});
