import { describe, it } from "vitest";

import { expectValid, getValidator, loadFixture } from "./_helpers.ts";

describe("luau-execution binary-input capture", () => {
	it("should validate the captured upload response against its schema", ({ expect }) => {
		expect.assertions(1);

		expectValid(expect, {
			fixture: loadFixture("luau-execution-task-binary-inputs", "create-response.json"),
			validator: getValidator("LuauExecutionSessionTaskBinaryInput"),
		});
	});
});
