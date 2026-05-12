import { parseLuauExecutionTaskResponse } from "#src/domains/cloud-v2/luau-execution-tasks/parsers";
import { assert, describe, expect, it } from "vitest";

import { loadFixture } from "./_helpers.ts";

// The vendored `LuauExecutionSessionTask` schema declares `timeout` as
// `format: "duration"` (ISO 8601 e.g. `"PT3S"`), but the upstream
// example and the live server both emit `"<n>s"` (e.g. `"3s"`). Ajv
// rejects the live shape against the declared format, so unlike the
// other resource specs this file does not run the schema validator
// against the recorded fixtures; the parser round-trip below covers
// the divergence between hand-built test bodies and the live wire.

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
