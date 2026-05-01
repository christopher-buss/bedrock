import { describe, expect, it } from "vitest";

import { GET_OPERATION_LIMIT, UPDATE_OPERATION_LIMIT } from "./operations.ts";

describe("universes operation limits", () => {
	it("should cap the get endpoint at 100 requests per minute", () => {
		expect.assertions(1);

		expect(GET_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "universes.get",
		});
	});

	it("should cap the update endpoint at 100 requests per minute", () => {
		expect.assertions(1);

		expect(UPDATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "universes.update",
		});
	});

	it("should key get and update independently so they do not share a queue", () => {
		expect.assertions(1);

		expect(GET_OPERATION_LIMIT.operationKey).not.toBe(UPDATE_OPERATION_LIMIT.operationKey);
	});
});
