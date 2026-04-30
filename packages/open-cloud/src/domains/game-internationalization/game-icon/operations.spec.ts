import { describe, expect, it } from "vitest";

import { ICON_OPERATION_LIMIT } from "./operations.ts";

describe("game-icon operation limit", () => {
	it("should cap the service at 100 requests per minute under one shared key", () => {
		expect.assertions(1);

		expect(ICON_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "experience-icon",
		});
	});

	it("should freeze the operation limit so callers cannot mutate the registry", () => {
		expect.assertions(1);

		expect(Object.isFrozen(ICON_OPERATION_LIMIT)).toBeTrue();
	});
});
