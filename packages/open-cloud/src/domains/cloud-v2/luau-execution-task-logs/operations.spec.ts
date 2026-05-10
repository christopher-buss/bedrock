import { describe, expect, it } from "vitest";

import { LIST_LOGS_OPERATION_LIMIT, LIST_LOGS_REQUIRED_SCOPES } from "./operations.ts";

describe("luau-execution-task-logs list operation limit", () => {
	it("should cap list-logs at 45 requests per minute under the luau-execution-task-logs.list key", () => {
		expect.assertions(1);

		expect(LIST_LOGS_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 45 / 60,
			operationKey: "luau-execution-task-logs.list",
		});
	});
});

describe("luau-execution-task-logs required scopes", () => {
	it("should require the :read scope to list a task's logs", () => {
		expect.assertions(1);

		expect(LIST_LOGS_REQUIRED_SCOPES).toStrictEqual([
			"universe.place.luau-execution-session:read",
		]);
	});
});
