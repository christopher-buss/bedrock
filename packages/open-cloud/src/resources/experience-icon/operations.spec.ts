import { describe, expect, it } from "vitest";

import { OPERATION_LIMIT } from "./operations.ts";

describe("experience-icon operation limit", () => {
	it("should cap the service at 100 requests per minute under one shared key", () => {
		expect.assertions(1);

		expect(OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "experience-icon",
		});
	});

	it("should freeze the operation limit so callers cannot mutate the registry", () => {
		expect.assertions(1);

		expect(Object.isFrozen(OPERATION_LIMIT)).toBeTrue();
	});
});
