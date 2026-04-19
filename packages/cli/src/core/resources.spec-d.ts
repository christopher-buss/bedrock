import { describe, expectTypeOf, it } from "vitest";

import type {
	GamePassDesiredState,
	GamePassOutputs,
	ResourceDesiredState,
	ResourceKind,
	ResourceOutputs,
} from "./resources.ts";

describe("ResourceDesiredState", () => {
	it("should narrow to GamePassDesiredState when kind is gamePass", () => {
		expectTypeOf<
			Extract<ResourceDesiredState, { kind: "gamePass" }>
		>().toEqualTypeOf<GamePassDesiredState>();
	});
});

describe("ResourceKind", () => {
	it("should equal the gamePass discriminator literal", () => {
		expectTypeOf<ResourceKind>().toEqualTypeOf<"gamePass">();
	});
});

describe("ResourceOutputs", () => {
	it("should resolve gamePass to GamePassOutputs", () => {
		expectTypeOf<ResourceOutputs<"gamePass">>().toEqualTypeOf<GamePassOutputs>();
	});

	it("should reject an unmapped resource kind at compile time", () => {
		type UnmappedKind = "experience";
		// @ts-expect-error UnmappedKind does not extend ResourceKind, so the
		// generic constraint on ResourceOutputs refuses the lookup.
		expectTypeOf<ResourceOutputs<UnmappedKind>>().toBeObject();
	});
});
