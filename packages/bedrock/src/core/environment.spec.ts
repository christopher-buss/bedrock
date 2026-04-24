import { assert, describe, expect, it } from "vitest";

import { validateEnvironmentName } from "./environment.ts";

describe(validateEnvironmentName, () => {
	it.for<[string]>([
		["production"],
		["staging"],
		["pr-1234"],
		["branch_name"],
		["DEV"],
		["a"],
		["a".repeat(64)],
	])("should accept %s as a safe environment name", ([name]) => {
		expect.assertions(2);

		const result = validateEnvironmentName(name);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe(name);
	});

	it.for<[string, string]>([
		["", "empty string"],
		["prod/staging", "contains a slash"],
		["prod..staging", "contains a dot"],
		["prod staging", "contains whitespace"],
		["a".repeat(65), "exceeds the 64 character cap"],
		["prod\nstaging", "contains a newline"],
		["prod:staging", "contains a colon"],
	])("should reject %s because it %s", ([name]) => {
		expect.assertions(2);

		const result = validateEnvironmentName(name);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err).toMatchObject({ kind: "stateError" });
	});
});
