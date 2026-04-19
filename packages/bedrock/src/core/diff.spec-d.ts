import { describe, expectTypeOf, it } from "vitest";

import { diff } from "./diff.ts";
import type { Operation } from "./operations.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "./resources.ts";

describe(diff, () => {
	it("should accept readonly arrays of desired and current state", () => {
		expectTypeOf(diff).parameter(0).toEqualTypeOf<ReadonlyArray<ResourceDesiredState>>();
		expectTypeOf(diff).parameter(1).toEqualTypeOf<ReadonlyArray<ResourceCurrentState>>();
	});

	it("should return a readonly array of Operation", () => {
		expectTypeOf(diff).returns.toEqualTypeOf<ReadonlyArray<Operation>>();
	});
});
