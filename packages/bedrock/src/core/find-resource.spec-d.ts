import { describe, expectTypeOf, it } from "vitest";

import { findResource } from "./find-resource.ts";
import type { ResourceCurrentState } from "./resources.ts";

describe(findResource, () => {
	it("should narrow the result to the selected kind", () => {
		const found = findResource([], { kind: "gamePass" });

		expectTypeOf(found).toEqualTypeOf<ResourceCurrentState<"gamePass"> | undefined>();
	});

	it("should accept a readonly array of any-kind resources", () => {
		expectTypeOf(findResource)
			.parameter(0)
			.toEqualTypeOf<ReadonlyArray<ResourceCurrentState>>();
	});
});
