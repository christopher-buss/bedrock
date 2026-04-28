import { describe, expect, it } from "vitest";

import { mantleResource } from "./mantle-resource-fixture.ts";

describe(mantleResource, () => {
	it("should build a bare MantleResource with empty payloads and no dependencies", () => {
		expect.assertions(1);

		expect(mantleResource("badge", "first-win")).toStrictEqual({
			key: "first-win",
			dependencies: [],
			inputs: {},
			kind: "badge",
			outputs: undefined,
		});
	});
});
