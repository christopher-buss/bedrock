import { assert, describe, expect, it } from "vitest";

import { migrateMantleState } from "./migrate-mantle-state.ts";

describe(migrateMantleState, () => {
	it("should return an internalError stub until later slices wire the implementation", async () => {
		expect.assertions(3);

		const result = await migrateMantleState({
			outputFormat: "typescript",
			stateFilePath: "/tmp/.mantle-state.yml",
		});

		assert(!result.success);
		assert(result.err.kind === "internalError");

		expect(result.err.kind).toBe("internalError");
		expect(result.err.cause.kind).toBe("validationFailed");
		expect(result.err.reason.length).toBeGreaterThan(0);
	});
});
