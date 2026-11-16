import { describe, it } from "vitest";

import { EXIT_ERROR, EXIT_OK, EXIT_SIGINT, EXIT_SIGTERM } from "./exit-codes.ts";

describe("exit codes", () => {
	it("should expose 0 as success and 1 as failure", ({ expect }) => {
		expect.assertions(2);

		expect(EXIT_OK).toBe(0);
		expect(EXIT_ERROR).toBe(1);
	});

	it("should expose 130 after SIGINT and 143 after SIGTERM", ({ expect }) => {
		expect.assertions(2);

		expect(EXIT_SIGINT).toBe(130);
		expect(EXIT_SIGTERM).toBe(143);
	});
});
