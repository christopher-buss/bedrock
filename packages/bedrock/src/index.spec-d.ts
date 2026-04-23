import type { Result } from "@bedrock/ocale";

import { describe, expectTypeOf, it } from "vitest";

import {
	applyOps,
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	buildDesired,
	createPlaceDriver,
	defineConfig,
	isResourceKey,
	isRobloxAssetId,
	isSha256Hex,
	loadConfig,
} from "./index.ts";
import type {
	ApplyError,
	BuildDesiredError,
	Config,
	ConfigContext,
	ConfigError,
	ConfigInput,
	ConfigValidationIssue,
	LoadConfigOptions,
	PlaceDesiredState,
	PlaceDriverDeps,
	PlaceEntry,
	PlaceOutputs,
	ResourceDesiredState,
	ResourceKey,
	RobloxAssetId,
	Sha256Hex,
} from "./index.ts";

interface ExpectedFileNotFound {
	readonly kind: "fileNotFound";
	readonly searchedFrom: string;
}

interface ExpectedParseFailed {
	readonly kind: "parseFailed";
	readonly message: string;
	readonly sourceFile: string;
}

interface ExpectedConfigFunctionFailed {
	readonly kind: "configFunctionFailed";
	readonly message: string;
	readonly sourceFile: string;
}

interface ExpectedValidationFailed {
	readonly issues: ReadonlyArray<ConfigValidationIssue>;
	readonly kind: "validationFailed";
	readonly sourceFile: string;
}

function syncConfigBuilder(_ctx: ConfigContext): Config {
	return { passes: {} };
}

async function asyncConfigBuilder(_ctx: ConfigContext): Promise<Config> {
	return { passes: {} };
}

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

	it("should narrow BuildDesiredError to the fileReadFailed kind", () => {
		expectTypeOf<BuildDesiredError["kind"]>().toEqualTypeOf<"fileReadFailed">();
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

describe("Config", () => {
	it("should expose exactly the five documented root fields", () => {
		expectTypeOf<keyof Config>().toEqualTypeOf<
			"environments" | "experience" | "extends" | "passes" | "places"
		>();
	});

	it("should reserve environments, experience, and extends as unknown", () => {
		expectTypeOf<Config["environments"]>().toEqualTypeOf<unknown>();
		expectTypeOf<Config["experience"]>().toEqualTypeOf<unknown>();
		expectTypeOf<Config["extends"]>().toEqualTypeOf<unknown>();
	});

	it("should treat every root field as optional so an empty object satisfies Config", () => {
		expectTypeOf<Record<string, never>>().toExtend<Config>();
	});
});

describe(defineConfig, () => {
	it("should preserve the literal type when given a plain object", () => {
		const literal = {
			passes: {
				"vip-pass": {
					name: "VIP Pass",
					description: "Grants VIP perks.",
					iconFilePath: "assets/vip-icon.png",
					price: 500,
				},
			},
		};
		expectTypeOf(defineConfig(literal)).toEqualTypeOf<typeof literal>();
	});

	it("should preserve the function type when given a sync config function", () => {
		expectTypeOf(defineConfig(syncConfigBuilder)).toEqualTypeOf<typeof syncConfigBuilder>();
	});

	it("should preserve the function type when given an async config function", () => {
		expectTypeOf(defineConfig(asyncConfigBuilder)).toEqualTypeOf<typeof asyncConfigBuilder>();
	});

	it("should constrain its generic to ConfigInput", () => {
		expectTypeOf(defineConfig).parameter(0).toEqualTypeOf<ConfigInput>();
	});
});

describe(loadConfig, () => {
	it("should accept an optional LoadConfigOptions argument", () => {
		expectTypeOf(loadConfig).parameter(0).toEqualTypeOf<LoadConfigOptions | undefined>();
	});

	it("should resolve to a Result of Config or ConfigError", () => {
		expectTypeOf<Awaited<ReturnType<typeof loadConfig>>>().toEqualTypeOf<
			Result<Config, ConfigError>
		>();
	});
});

describe("ConfigError", () => {
	it("should discriminate on kind across the four documented variants", () => {
		expectTypeOf<ConfigError["kind"]>().toEqualTypeOf<
			"configFunctionFailed" | "fileNotFound" | "parseFailed" | "validationFailed"
		>();
	});

	it("should narrow fileNotFound to carry only searchedFrom", () => {
		expectTypeOf<
			Extract<ConfigError, { kind: "fileNotFound" }>
		>().toEqualTypeOf<ExpectedFileNotFound>();
	});

	it("should narrow parseFailed to carry message and sourceFile", () => {
		expectTypeOf<
			Extract<ConfigError, { kind: "parseFailed" }>
		>().toEqualTypeOf<ExpectedParseFailed>();
	});

	it("should narrow configFunctionFailed to carry message and sourceFile", () => {
		expectTypeOf<
			Extract<ConfigError, { kind: "configFunctionFailed" }>
		>().toEqualTypeOf<ExpectedConfigFunctionFailed>();
	});

	it("should narrow validationFailed to carry issues and sourceFile", () => {
		expectTypeOf<
			Extract<ConfigError, { kind: "validationFailed" }>
		>().toEqualTypeOf<ExpectedValidationFailed>();
	});
});

describe("PlaceEntry", () => {
	it("should expose exactly placeId and filePath as strings", () => {
		expectTypeOf<keyof PlaceEntry>().toEqualTypeOf<"filePath" | "placeId">();
		expectTypeOf<PlaceEntry["placeId"]>().toEqualTypeOf<string>();
		expectTypeOf<PlaceEntry["filePath"]>().toEqualTypeOf<string>();
	});
});

describe("PlaceDesiredState", () => {
	it("should carry the file-backed fields under kind place", () => {
		expectTypeOf<PlaceDesiredState["kind"]>().toEqualTypeOf<"place">();
		expectTypeOf<PlaceDesiredState["placeId"]>().toEqualTypeOf<RobloxAssetId>();
		expectTypeOf<PlaceDesiredState["fileHash"]>().toEqualTypeOf<Sha256Hex>();
		expectTypeOf<PlaceDesiredState["filePath"]>().toEqualTypeOf<string>();
		expectTypeOf<PlaceDesiredState["key"]>().toEqualTypeOf<ResourceKey>();
	});
});

describe("PlaceOutputs", () => {
	it("should carry only a readonly versionNumber", () => {
		expectTypeOf<keyof PlaceOutputs>().toEqualTypeOf<"versionNumber">();
		expectTypeOf<PlaceOutputs["versionNumber"]>().toEqualTypeOf<number>();
	});
});

describe("PlaceDriverDeps", () => {
	it("should expose client, readFile, and universeId", () => {
		expectTypeOf<keyof PlaceDriverDeps>().toEqualTypeOf<"client" | "readFile" | "universeId">();
		expectTypeOf<PlaceDriverDeps["universeId"]>().toEqualTypeOf<RobloxAssetId>();
	});
});

describe(createPlaceDriver, () => {
	it("should return a ResourceDriver with create and an optional update", () => {
		type Driver = ReturnType<typeof createPlaceDriver>;
		expectTypeOf<Driver["create"]>().toBeFunction();
		expectTypeOf<Driver["update"]>().not.toBeUndefined();
	});
});
