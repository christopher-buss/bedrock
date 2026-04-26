import { describe, expectTypeOf, it } from "vitest";

import type { ConfigError, ConfigValidationIssue } from "./config-error.ts";

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

interface ExpectedLuauRuntimeMissing {
	readonly hint: string;
	readonly kind: "luauRuntimeMissing";
	readonly sourceFile: string;
}

describe("ConfigError discriminant", () => {
	it("should discriminate on kind across the five documented variants", () => {
		expectTypeOf<ConfigError["kind"]>().toEqualTypeOf<
			| "configFunctionFailed"
			| "fileNotFound"
			| "luauRuntimeMissing"
			| "parseFailed"
			| "validationFailed"
		>();
	});
});

describe("ConfigError variants", () => {
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

	it("should narrow luauRuntimeMissing to carry hint and sourceFile", () => {
		expectTypeOf<
			Extract<ConfigError, { kind: "luauRuntimeMissing" }>
		>().toEqualTypeOf<ExpectedLuauRuntimeMissing>();
	});
});
