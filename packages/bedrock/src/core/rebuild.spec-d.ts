import { describe, expectTypeOf, it } from "vitest";

import type { ResourceKey } from "../types/ids.ts";
import type { RebuildHook, RebuiltPlace } from "./rebuild.ts";
import type { BedrockState } from "./state.ts";

describe("RebuiltPlace", () => {
	it("should carry rebuilt bytes keyed by a resource key", () => {
		expectTypeOf<RebuiltPlace["bytes"]>().toEqualTypeOf<Uint8Array>();
		expectTypeOf<RebuiltPlace["key"]>().toEqualTypeOf<ResourceKey>();
	});
});

describe("RebuildHook", () => {
	it("should receive the post-asset-stage state of the deployed environment", () => {
		expectTypeOf<Parameters<RebuildHook>[0]>().toEqualTypeOf<{
			readonly state: BedrockState;
		}>();
	});

	it("should return rebuilt places synchronously or asynchronously", () => {
		expectTypeOf<ReturnType<RebuildHook>>().toEqualTypeOf<
			Promise<ReadonlyArray<RebuiltPlace>> | ReadonlyArray<RebuiltPlace>
		>();
	});
});
