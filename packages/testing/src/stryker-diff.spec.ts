import { describe, expect, it } from "vitest";

import { parseDiff } from "./stryker-diff.ts";

describe(parseDiff, () => {
	it("should return no files for an empty diff", () => {
		expect.assertions(1);

		const result = parseDiff("");

		expect(result).toStrictEqual({ files: [], kind: "changes" });
	});

	it("should reject a rename with the old and new paths", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/old.ts b/src/new.ts",
			"similarity index 100%",
			"rename from src/old.ts",
			"rename to src/new.ts",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			kind: "reject",
			reasons: [{ from: "src/old.ts", kind: "rename", to: "src/new.ts" }],
		});
	});

	it("should extract the hunk range for a single modified file", () => {
		expect.assertions(1);

		const raw = [
			"diff --git a/src/foo.ts b/src/foo.ts",
			"index abc1234..def5678 100644",
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -5,2 +5,3 @@",
			"-old",
			"-old",
			"+new",
			"+new",
			"+new",
		].join("\n");

		const result = parseDiff(raw);

		expect(result).toStrictEqual({
			files: [{ hunks: [{ endLine: 7, startLine: 5 }], path: "src/foo.ts" }],
			kind: "changes",
		});
	});
});
