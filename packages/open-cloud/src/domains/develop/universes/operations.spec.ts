import { describe, it } from "vitest";

import {
	ACTIVATE_OPERATION_LIMIT,
	ACTIVATION_REQUIRED_SCOPES,
	DEACTIVATE_OPERATION_LIMIT,
} from "./operations.ts";

describe("experience activation operation metadata", () => {
	it("should pace activation and deactivation independently at the OpenAPI limit", ({
		expect,
	}) => {
		expect.assertions(2);
		expect(ACTIVATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "universes.activate",
		});
		expect(DEACTIVATE_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "universes.deactivate",
		});
	});

	it("should name the scope required by both visibility operations", ({ expect }) => {
		expect.assertions(1);
		expect(ACTIVATION_REQUIRED_SCOPES).toStrictEqual(["legacy-universe:manage"]);
	});
});
