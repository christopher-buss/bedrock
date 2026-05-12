import { parseLuauExecutionTaskResponse } from "#src/domains/cloud-v2/luau-execution-tasks/parsers";
import { assert, describe, expect, it } from "vitest";

import { loadFixture } from "./_helpers.ts";

describe("luau-execution-tasks fixtures", () => {
	describe(parseLuauExecutionTaskResponse, () => {
		it("should round-trip submit-response-processing.json into an in-progress task whose timestamps are undefined", () => {
			expect.assertions(5);

			const body = loadFixture("luau-execution-tasks", "submit-response-processing.json");

			const result = parseLuauExecutionTaskResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.state).toBe("PROCESSING");
			expect(result.data.user).toBe("1910140");
			expect(result.data.timeoutSeconds).toBe(60);
			expect(result.data.createdAt).toBeUndefined();
			expect(result.data.updatedAt).toBeUndefined();
		});

		it("should round-trip get-response-complete.json into a COMPLETE task whose timestamps and output are surfaced", () => {
			expect.assertions(4);

			const body = loadFixture("luau-execution-tasks", "get-response-complete.json");

			const result = parseLuauExecutionTaskResponse({ body, headers: {}, status: 200 });

			assert(result.success);
			assert(result.data.state === "COMPLETE");

			expect(result.data.output.results).toStrictEqual([1]);
			expect(result.data.createdAt).toStrictEqual(new Date("2026-05-12T01:42:25.171Z"));
			expect(result.data.updatedAt).toStrictEqual(new Date("2026-05-12T01:42:26.443Z"));
			expect(result.data.timeoutSeconds).toBe(60);
		});
	});
});
