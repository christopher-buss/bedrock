import { describe, it } from "vitest";

import { expectValid, getValidator, loadFixture } from "./_helpers.ts";

describe("luau-execution logs captures", () => {
	it.for([
		"list-response.json",
		"list-no-print-response.json",
		"list-no-print-confirm-response.json",
	])("should validate captured %s against the logs schema", (fixture, { expect }) => {
		expect.assertions(1);

		expectValid(expect, {
			fixture: loadFixture("luau-execution-task-logs", fixture),
			validator: getValidator("ListLuauExecutionSessionTaskLogsResponse"),
		});
	});
});
