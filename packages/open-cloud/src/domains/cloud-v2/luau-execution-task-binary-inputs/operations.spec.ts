import { describe, expect, it } from "vitest";

import { CREATE_OPERATION_LIMIT, CREATE_REQUIRED_SCOPES } from "./operations.ts";

describe("luau-execution-task-binary-inputs operations", () => {
	it("should cap binary-input create at 5 requests per minute under the luau-execution-task-binary-inputs.create key", () => {
		expect.assertions(1);

		expect(CREATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 5 / 60,
			operationKey: "luau-execution-task-binary-inputs.create",
		});
	});

	it("should require the :write scope to create a binary input", () => {
		expect.assertions(1);

		expect(CREATE_REQUIRED_SCOPES).toStrictEqual([
			"universe.place.luau-execution-session:write",
		]);
	});
});
