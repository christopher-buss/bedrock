import { describe, expectTypeOf, it } from "vitest";

import { diff } from "./diff.ts";
import type { RetiredInput } from "./flatten.ts";
import type { Operation } from "./operations.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "./resources.ts";

describe(diff, () => {
	it("should accept readonly arrays of desired and current state", () => {
		expectTypeOf(diff)
			.parameter(0)
			.toEqualTypeOf<ReadonlyArray<ResourceDesiredState | RetiredInput>>();
		expectTypeOf(diff).parameter(1).toEqualTypeOf<ReadonlyArray<ResourceCurrentState>>();
	});

	it("should accept an optional strict orphan policy without changing the return contract", () => {
		expectTypeOf(diff)
			.parameter(2)
			.toEqualTypeOf<undefined | { readonly orphans?: "error" | "retire" }>();

		// @ts-expect-error Only supported policies may be selected.
		diff([], [], { orphans: "delete" });
	});

	it("should return a readonly array of Operation", () => {
		expectTypeOf(diff).returns.toEqualTypeOf<ReadonlyArray<Operation>>();
	});
});
