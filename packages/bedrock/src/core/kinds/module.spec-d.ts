import type { Result } from "@bedrock-rbx/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { ResourceKey } from "../../types/ids.ts";
import type { BuildDesiredError, ResourceKindModule } from "./module.ts";

describe("kind retirement contract", () => {
	it("should require an explicit retirement verdict for a key without requiring state", () => {
		expectTypeOf<Parameters<ResourceKindModule<"gamePass">["assertRetirable"]>>().toEqualTypeOf<
			[ResourceKey]
		>();
		expectTypeOf<ReturnType<ResourceKindModule<"gamePass">["assertRetirable"]>>().toEqualTypeOf<
			Result<undefined, Extract<BuildDesiredError, { readonly kind: "retirementRejected" }>>
		>();
		expectTypeOf<object>().not.toExtend<
			Pick<ResourceKindModule<"gamePass">, "assertRetirable">
		>();
	});
});
