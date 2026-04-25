import { describe, expect, it } from "vitest";

import { EXIT_ERROR, EXIT_OK } from "./exit-codes.ts";

describe("exit codes", () => {
	it("should expose 0 as success and 1 as failure", () => {
		expect.assertions(2);

		expect(EXIT_OK).toBe(0);
		expect(EXIT_ERROR).toBe(1);
	});
});
