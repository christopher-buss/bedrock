import { describe, expect, it } from "vitest";

import { THUMBNAILS_OPERATION_LIMIT } from "./operations.ts";

describe("game-thumbnails operation limit", () => {
	it("should cap the service at 100 requests per minute under one shared key", () => {
		expect.assertions(1);

		expect(THUMBNAILS_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "experience-thumbnails",
		});
	});

	it("should freeze the operation limit so callers cannot mutate the registry", () => {
		expect.assertions(1);

		expect(Object.isFrozen(THUMBNAILS_OPERATION_LIMIT)).toBeTrue();
	});
});
