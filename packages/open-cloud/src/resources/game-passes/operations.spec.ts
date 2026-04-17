import { describe, expect, it } from "vitest";

import { CREATE_OPERATION_LIMIT, GET_OPERATION_LIMIT } from "./operations.ts";

describe("gET_OPERATION_LIMIT", () => {
	it("should identify the game-passes read endpoint with maxPerSecond=10", () => {
		expect.assertions(1);

		expect(GET_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 10,
			operationKey: "game-passes.get",
		});
	});
});

describe("cREATE_OPERATION_LIMIT", () => {
	it("should identify the game-passes create endpoint with maxPerSecond=5", () => {
		expect.assertions(1);

		expect(CREATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5,
			operationKey: "game-passes.create",
		});
	});
});
