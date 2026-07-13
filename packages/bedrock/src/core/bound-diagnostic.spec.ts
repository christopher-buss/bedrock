import { describe, expect, it } from "vitest";

import { boundDiagnostic } from "./bound-diagnostic.ts";

describe(boundDiagnostic, () => {
	it("should return text within the cap unchanged", () => {
		expect.assertions(1);

		expect(boundDiagnostic("short body")).toBe("short body");
	});

	it("should keep text of exactly 500 characters untruncated", () => {
		expect.assertions(1);

		expect(boundDiagnostic("x".repeat(500))).toBe("x".repeat(500));
	});

	it("should truncate text beyond 500 characters with an ellipsis", () => {
		expect.assertions(1);

		expect(boundDiagnostic("x".repeat(501))).toBe(`${"x".repeat(500)}…`);
	});
});
