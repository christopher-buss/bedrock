import { describe, expectTypeOf, it } from "vitest";

import type { ResourceKey } from "./index.ts";

describe("ResourceKey", () => {
	it("should be assignable to string (brand widens to string)", () => {
		expectTypeOf<ResourceKey>().toExtend<string>();
	});

	it("should not accept a plain string without the brand", () => {
		expectTypeOf<string>().not.toExtend<ResourceKey>();
	});
});
