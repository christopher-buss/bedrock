import { describe, it } from "vitest";

import { GET_OPERATION_LIMIT } from "#src/domains/cloud-v2/places/operations";
import { perMinuteAllowance } from "./_helpers.ts";

describe("place GET rate limit", () => {
	it("should pace place reads at the quota declared by Cloud_GetPlace", ({ expect }) => {
		expect.assertions(2);
		expect(GET_OPERATION_LIMIT.maxPerSecond).toBe(perMinuteAllowance("Cloud_GetPlace") / 60);
		expect(GET_OPERATION_LIMIT.operationKey).toBe("places.get");
	});
});
