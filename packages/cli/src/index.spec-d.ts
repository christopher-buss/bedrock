import { describe, expectTypeOf, it } from "vitest";

import { isRobloxAssetId } from "./index.ts";
import type { ResourceKey, RobloxAssetId } from "./index.ts";

describe("ResourceKey", () => {
	it("should be assignable to string (brand widens to string)", () => {
		expectTypeOf<ResourceKey>().toExtend<string>();
	});

	it("should not accept a plain string without the brand", () => {
		expectTypeOf<string>().not.toExtend<ResourceKey>();
	});
});

describe("RobloxAssetId", () => {
	it("should be assignable to string (brand widens to string)", () => {
		expectTypeOf<RobloxAssetId>().toExtend<string>();
	});

	it("should not accept a plain string without the brand", () => {
		expectTypeOf<string>().not.toExtend<RobloxAssetId>();
	});

	it("should not be assignable to or from ResourceKey", () => {
		expectTypeOf<RobloxAssetId>().not.toExtend<ResourceKey>();
		expectTypeOf<ResourceKey>().not.toExtend<RobloxAssetId>();
	});
});

describe(isRobloxAssetId, () => {
	it("should carry a type predicate narrowing to RobloxAssetId", () => {
		expectTypeOf(isRobloxAssetId).toEqualTypeOf<(raw: string) => raw is RobloxAssetId>();
	});
});
