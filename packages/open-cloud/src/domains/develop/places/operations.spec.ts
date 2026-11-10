import { describe, it } from "vitest";

import { LIST_PLACES_BASE_URL, LIST_PLACES_OPERATION_LIMIT } from "./operations.ts";

describe("places list operation metadata", () => {
	it("should pace reads at the observed 10000 per minute on develop.roblox.com", ({ expect }) => {
		expect.assertions(2);
		expect(LIST_PLACES_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 10_000 / 60,
			operationKey: "places.list",
		});
		expect(LIST_PLACES_BASE_URL).toBe("https://develop.roblox.com");
	});
});
