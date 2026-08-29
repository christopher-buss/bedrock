import { type } from "arktype";
import { describe, expectTypeOf, it } from "vitest";

import type { BedrockPlugin, StateBackendDeclaration, StateBackendSchema } from "./plugin.ts";

describe("StateBackendSchema assignability", () => {
	it("should accept a concretely-typed arktype schema", () => {
		expectTypeOf(
			type({ "bucket": "string > 0", "region?": "string" }),
		).toExtend<StateBackendSchema>();
	});

	it("should reject a schema whose output is not an object", () => {
		expectTypeOf(type("string")).not.toExtend<StateBackendSchema>();
	});
});

describe("BedrockPlugin", () => {
	it("should let a plugin contribute no backends at all", () => {
		expectTypeOf<Record<string, never>>().toExtend<BedrockPlugin>();
	});

	it("should carry the declarations a plugin contributes", () => {
		expectTypeOf<Required<BedrockPlugin>["stateBackends"]>().toEqualTypeOf<
			ReadonlyArray<StateBackendDeclaration>
		>();
	});
});

describe("StateBackendDeclaration", () => {
	it("should carry the backend name as the literal the declaration claims", () => {
		expectTypeOf<
			StateBackendDeclaration<{ bucket: string }, "s3">["name"]
		>().toEqualTypeOf<"s3">();
	});

	it("should leave the backend name open when the declaration names no literal", () => {
		expectTypeOf<StateBackendDeclaration["name"]>().toEqualTypeOf<string>();
	});
});
