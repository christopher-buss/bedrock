import { describe, expectTypeOf, it } from "vitest";

import { isResourceKey, isRobloxAssetId, isSha256Hex } from "./index.ts";
import type { ResourceKey, RobloxAssetId, Sha256Hex } from "./index.ts";

const brandShapeCases: ReadonlyArray<readonly [name: string, assertShape: () => void]> = [
	[
		"ResourceKey",
		() => {
			expectTypeOf<ResourceKey>().toExtend<string>();
			expectTypeOf<string>().not.toExtend<ResourceKey>();
		},
	],
	[
		"RobloxAssetId",
		() => {
			expectTypeOf<RobloxAssetId>().toExtend<string>();
			expectTypeOf<string>().not.toExtend<RobloxAssetId>();
		},
	],
	[
		"Sha256Hex",
		() => {
			expectTypeOf<Sha256Hex>().toExtend<string>();
			expectTypeOf<string>().not.toExtend<Sha256Hex>();
		},
	],
];

describe("branded id types", () => {
	it.for(brandShapeCases)(
		"should declare %s as a distinct brand over string",
		([, assertShape]) => {
			assertShape();
		},
	);

	it("should treat each brand as mutually non-assignable", () => {
		expectTypeOf<ResourceKey>().not.toExtend<RobloxAssetId>();
		expectTypeOf<ResourceKey>().not.toExtend<Sha256Hex>();
		expectTypeOf<RobloxAssetId>().not.toExtend<ResourceKey>();
		expectTypeOf<RobloxAssetId>().not.toExtend<Sha256Hex>();
		expectTypeOf<Sha256Hex>().not.toExtend<ResourceKey>();
		expectTypeOf<Sha256Hex>().not.toExtend<RobloxAssetId>();
	});
});

describe(isResourceKey, () => {
	it("should carry a type predicate narrowing to ResourceKey", () => {
		expectTypeOf(isResourceKey).toEqualTypeOf<(raw: string) => raw is ResourceKey>();
	});
});

describe(isRobloxAssetId, () => {
	it("should carry a type predicate narrowing to RobloxAssetId", () => {
		expectTypeOf(isRobloxAssetId).toEqualTypeOf<(raw: string) => raw is RobloxAssetId>();
	});
});

describe(isSha256Hex, () => {
	it("should carry a type predicate narrowing to Sha256Hex", () => {
		expectTypeOf(isSha256Hex).toEqualTypeOf<(raw: string) => raw is Sha256Hex>();
	});
});
