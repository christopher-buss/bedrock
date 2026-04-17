import { describe, expect, it } from "vitest";

import { CREATE_OPERATION_LIMIT, GET_OPERATION_LIMIT } from "./operations.ts";

describe("game-passes operation limits", () => {
	it("should cap the read endpoint at 10 requests per second", () => {
		expect.assertions(1);

		expect(GET_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 10,
			operationKey: "game-passes.get",
		});
	});

	it("should cap the create endpoint at 5 requests per second", () => {
		expect.assertions(1);

		expect(CREATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5,
			operationKey: "game-passes.create",
		});
	});
});
