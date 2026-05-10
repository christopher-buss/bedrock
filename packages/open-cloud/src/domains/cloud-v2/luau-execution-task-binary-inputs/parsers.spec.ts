import { assert, describe, expect, it } from "vitest";

import { parseBinaryInputResponse } from "./parsers.ts";

function validBody(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		path: "universes/123/luau-execution-session-task-binary-inputs/abc",
		uploadUri: "https://storage.example.com/upload?token=xyz",
		...overrides,
	};
}

describe(parseBinaryInputResponse, () => {
	it("should parse a wire body with path and uploadUri into a LuauExecutionTaskBinaryInput", () => {
		expect.assertions(2);

		const result = parseBinaryInputResponse({
			body: validBody(),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.path).toBe(
			"universes/123/luau-execution-session-task-binary-inputs/abc",
		);
		expect(result.data.uploadUri).toBe("https://storage.example.com/upload?token=xyz");
	});
});
