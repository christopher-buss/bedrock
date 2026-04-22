import type { Result } from "@bedrock/ocale";

import { describe, expectTypeOf, it } from "vitest";

import {
	applyOps,
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	buildDesired,
	isResourceKey,
	isRobloxAssetId,
	isSha256Hex,
} from "./index.ts";
import type {
	ApplyError,
	BuildDesiredError,
	ResourceDesiredState,
	ResourceKey,
	RobloxAssetId,
	Sha256Hex,
} from "./index.ts";

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

describe(asResourceKey, () => {
	it("should return a ResourceKey", () => {
		expectTypeOf(asResourceKey).toEqualTypeOf<(raw: string) => ResourceKey>();
	});
});

describe(asRobloxAssetId, () => {
	it("should return a RobloxAssetId", () => {
		expectTypeOf(asRobloxAssetId).toEqualTypeOf<(raw: string) => RobloxAssetId>();
	});
});

describe(asSha256Hex, () => {
	it("should return a Sha256Hex", () => {
		expectTypeOf(asSha256Hex).toEqualTypeOf<(raw: string) => Sha256Hex>();
	});
});

describe(buildDesired, () => {
	it("should resolve to a Result of readonly desired state or BuildDesiredError", () => {
		expectTypeOf<Awaited<ReturnType<typeof buildDesired>>>().toEqualTypeOf<
			Result<ReadonlyArray<ResourceDesiredState>, BuildDesiredError>
		>();
	});

	it("should narrow BuildDesiredError to the iconReadFailed kind", () => {
		expectTypeOf<BuildDesiredError["kind"]>().toEqualTypeOf<"iconReadFailed">();
	});
});

describe(applyOps, () => {
	it("should resolve to a Result of undefined or ApplyError", () => {
		expectTypeOf<Awaited<ReturnType<typeof applyOps>>>().toEqualTypeOf<
			Result<undefined, ApplyError>
		>();
	});

	it("should discriminate ApplyError on driverFailure and updateUnsupported kinds", () => {
		expectTypeOf<ApplyError["kind"]>().toEqualTypeOf<"driverFailure" | "updateUnsupported">();
	});
});
