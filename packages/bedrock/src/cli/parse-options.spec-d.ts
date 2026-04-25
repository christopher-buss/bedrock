import type { Result } from "@bedrock/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { CommonOptions, ParseOptionsError } from "./parse-options.ts";
import { parseCommonOptions } from "./parse-options.ts";

describe("CommonOptions", () => {
	it("should expose exactly the four documented common-flag fields", () => {
		expectTypeOf<keyof CommonOptions>().toEqualTypeOf<
			"apiKey" | "configFile" | "environments" | "githubToken"
		>();
	});

	it("should require environments and leave the credentials slots optional", () => {
		expectTypeOf<CommonOptions["environments"]>().toEqualTypeOf<ReadonlyArray<string>>();
		expectTypeOf<CommonOptions["apiKey"]>().toEqualTypeOf<string | undefined>();
		expectTypeOf<CommonOptions["configFile"]>().toEqualTypeOf<string | undefined>();
		expectTypeOf<CommonOptions["githubToken"]>().toEqualTypeOf<string | undefined>();
	});
});

describe("ParseOptionsError", () => {
	it("should discriminate on kind across the missingRequired and unknownFlag variants", () => {
		expectTypeOf<ParseOptionsError["kind"]>().toEqualTypeOf<
			"missingRequired" | "unknownFlag"
		>();
	});

	it("should attach a flag name to every variant", () => {
		expectTypeOf<ParseOptionsError["flag"]>().toEqualTypeOf<string>();
	});
});

describe(parseCommonOptions, () => {
	it("should resolve to a Result of CommonOptions or ParseOptionsError", () => {
		expectTypeOf<ReturnType<typeof parseCommonOptions>>().toEqualTypeOf<
			Result<CommonOptions, ParseOptionsError>
		>();
	});
});
