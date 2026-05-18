import { describe, expectTypeOf, it } from "vitest";

import type { ResourceKey } from "../types/ids.ts";
import type { CreateOperation, NoopOperation, Operation, UpdateOperation } from "./operations.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "./resources.ts";

describe("Operation", () => {
	it("should enumerate exactly the three slice-1 variants in the type discriminator", () => {
		expectTypeOf<Operation["type"]>().toEqualTypeOf<"create" | "noop" | "update">();
	});

	it("should expose key on the union without narrowing via the hoisted BaseOperation field", () => {
		expectTypeOf<Operation["key"]>().toEqualTypeOf<ResourceKey>();
	});

	it("should narrow to CreateOperation when type is create", () => {
		expectTypeOf<Extract<Operation, { type: "create" }>>().toEqualTypeOf<CreateOperation>();
	});

	it("should narrow to UpdateOperation when type is update", () => {
		expectTypeOf<Extract<Operation, { type: "update" }>>().toEqualTypeOf<UpdateOperation>();
	});

	it("should narrow to NoopOperation when type is noop", () => {
		expectTypeOf<Extract<Operation, { type: "noop" }>>().toEqualTypeOf<NoopOperation>();
	});
});

describe("CreateOperation", () => {
	it("should carry the desired resource state", () => {
		expectTypeOf<CreateOperation["desired"]>().toEqualTypeOf<ResourceDesiredState>();
	});

	it("should not carry a current resource state", () => {
		expectTypeOf<CreateOperation>().not.toHaveProperty("current");
	});
});

describe("UpdateOperation", () => {
	it("should carry the desired resource state", () => {
		expectTypeOf<UpdateOperation["desired"]>().toEqualTypeOf<ResourceDesiredState>();
	});

	it("should carry the current resource state", () => {
		expectTypeOf<UpdateOperation["current"]>().toEqualTypeOf<ResourceCurrentState>();
	});

	it("should carry changedFields as a readonly array of strings", () => {
		expectTypeOf<UpdateOperation["changedFields"]>().toEqualTypeOf<ReadonlyArray<string>>();
	});
});

describe("NoopOperation", () => {
	it("should not carry a desired resource state", () => {
		expectTypeOf<NoopOperation>().not.toHaveProperty("desired");
	});

	it("should not carry a current resource state", () => {
		expectTypeOf<NoopOperation>().not.toHaveProperty("current");
	});

	it("should not carry a changedFields array", () => {
		expectTypeOf<NoopOperation>().not.toHaveProperty("changedFields");
	});
});
