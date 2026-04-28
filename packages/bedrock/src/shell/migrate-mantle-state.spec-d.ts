import type { Result } from "@bedrock/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { ConfigError } from "../core/config-error.ts";
import type {
	MigrateError,
	MigrationReport,
	MigrationSummary,
	MigrationWarning,
	StatesByEnvironment,
} from "../core/migrate/migration-report.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import { migrateMantleState, type MigrateMantleStateDeps } from "./migrate-mantle-state.ts";

describe(migrateMantleState, () => {
	it("should accept a single MigrateMantleStateDeps argument", () => {
		expectTypeOf(migrateMantleState).parameter(0).toEqualTypeOf<MigrateMantleStateDeps>();
	});

	it("should resolve to a Result of MigrationReport or MigrateError", () => {
		expectTypeOf<Awaited<ReturnType<typeof migrateMantleState>>>().toEqualTypeOf<
			Result<MigrationReport, MigrateError>
		>();
	});
});

describe("MigrateMantleStateDeps", () => {
	it("should require stateFilePath and configFormat as the only non-optional fields", () => {
		expectTypeOf<{
			configFormat: "typescript" | "yaml";
			stateFilePath: string;
		}>().toExtend<MigrateMantleStateDeps>();
	});

	it("should accept the typescript and yaml literals on configFormat", () => {
		expectTypeOf<MigrateMantleStateDeps["configFormat"]>().toEqualTypeOf<
			"typescript" | "yaml"
		>();
	});

	it("should expose primaryEnvironment as an optional string", () => {
		expectTypeOf<MigrateMantleStateDeps["primaryEnvironment"]>().toEqualTypeOf<
			string | undefined
		>();
	});

	it("should accept an optional Uint8Array-returning readFile to match deploy and buildDesired", () => {
		expectTypeOf<MigrateMantleStateDeps["readFile"]>().toEqualTypeOf<
			((path: string) => Promise<Uint8Array>) | undefined
		>();
	});
});

describe("MigrationReport", () => {
	it("should expose exactly the five documented fields", () => {
		expectTypeOf<keyof MigrationReport>().toEqualTypeOf<
			"config" | "configFileContent" | "statesByEnvironment" | "summary" | "warnings"
		>();
	});

	it("should carry a Config for the validated bedrock projection", () => {
		expectTypeOf<MigrationReport["config"]>().toEqualTypeOf<Config>();
	});

	it("should carry a string for the rendered config file content", () => {
		expectTypeOf<MigrationReport["configFileContent"]>().toEqualTypeOf<string>();
	});

	it("should carry a Record of BedrockState for statesByEnvironment", () => {
		expectTypeOf<MigrationReport["statesByEnvironment"]>().toEqualTypeOf<StatesByEnvironment>();
		expectTypeOf<StatesByEnvironment>().toEqualTypeOf<Readonly<Record<string, BedrockState>>>();
	});

	it("should carry the MigrationSummary aggregate counts", () => {
		expectTypeOf<MigrationReport["summary"]>().toEqualTypeOf<MigrationSummary>();
	});

	it("should carry a readonly array of MigrationWarning entries", () => {
		expectTypeOf<MigrationReport["warnings"]>().toEqualTypeOf<
			ReadonlyArray<MigrationWarning>
		>();
	});
});

describe("MigrationSummary", () => {
	it("should expose one count field per MigrationWarning kind", () => {
		expectTypeOf<keyof MigrationSummary>().toEqualTypeOf<
			"ambiguousCount" | "blockedCount" | "deferredCount" | "interpretiveCount"
		>();
	});

	it("should type every count as number", () => {
		expectTypeOf<MigrationSummary["ambiguousCount"]>().toEqualTypeOf<number>();
		expectTypeOf<MigrationSummary["blockedCount"]>().toEqualTypeOf<number>();
		expectTypeOf<MigrationSummary["deferredCount"]>().toEqualTypeOf<number>();
		expectTypeOf<MigrationSummary["interpretiveCount"]>().toEqualTypeOf<number>();
	});
});

describe("MigrationWarning - shared shape", () => {
	it("should discriminate across the four classification kinds", () => {
		expectTypeOf<MigrationWarning["kind"]>().toEqualTypeOf<
			"ambiguous" | "blocked" | "deferred" | "interpretive"
		>();
	});

	it("should attach mantlePath to every variant", () => {
		expectTypeOf<MigrationWarning["mantlePath"]>().toEqualTypeOf<string>();
	});
});

describe("MigrationWarning - per-kind narrowing", () => {
	it("should narrow the interpretive variant to bedrockPath and rule", () => {
		expectTypeOf<
			Extract<MigrationWarning, { kind: "interpretive" }>["bedrockPath"]
		>().toEqualTypeOf<string>();
		expectTypeOf<
			Extract<MigrationWarning, { kind: "interpretive" }>["rule"]
		>().toEqualTypeOf<string>();
	});

	it("should narrow the ambiguous variant to a hint", () => {
		expectTypeOf<
			Extract<MigrationWarning, { kind: "ambiguous" }>["hint"]
		>().toEqualTypeOf<string>();
	});

	it("should narrow the blocked variant to a reason", () => {
		expectTypeOf<
			Extract<MigrationWarning, { kind: "blocked" }>["reason"]
		>().toEqualTypeOf<string>();
	});

	it("should narrow the deferred variant to a reason", () => {
		expectTypeOf<
			Extract<MigrationWarning, { kind: "deferred" }>["reason"]
		>().toEqualTypeOf<string>();
	});
});

describe("MigrateError - state-file variants", () => {
	it("should discriminate across the six failure kinds", () => {
		expectTypeOf<MigrateError["kind"]>().toEqualTypeOf<
			| "internalError"
			| "primaryEnvironmentNotFound"
			| "primaryEnvironmentRequired"
			| "stateFileNotFound"
			| "stateParseFailed"
			| "unsupportedMantleStateVersion"
		>();
	});

	it("should narrow stateFileNotFound to expose the offending path", () => {
		expectTypeOf<
			Extract<MigrateError, { kind: "stateFileNotFound" }>["path"]
		>().toEqualTypeOf<string>();
	});

	it("should narrow stateParseFailed to expose path and reason", () => {
		expectTypeOf<
			Extract<MigrateError, { kind: "stateParseFailed" }>["path"]
		>().toEqualTypeOf<string>();
		expectTypeOf<
			Extract<MigrateError, { kind: "stateParseFailed" }>["reason"]
		>().toEqualTypeOf<string>();
	});
});

describe("MigrateError - environment-selection variants", () => {
	it("should lock unsupportedMantleStateVersion's supported list to the v6 literal", () => {
		expectTypeOf<
			Extract<MigrateError, { kind: "unsupportedMantleStateVersion" }>["supported"]
		>().toEqualTypeOf<ReadonlyArray<"6">>();
		expectTypeOf<
			Extract<MigrateError, { kind: "unsupportedMantleStateVersion" }>["found"]
		>().toEqualTypeOf<string>();
	});

	it("should narrow primaryEnvironmentRequired to expose the available environment list", () => {
		expectTypeOf<
			Extract<MigrateError, { kind: "primaryEnvironmentRequired" }>["available"]
		>().toEqualTypeOf<ReadonlyArray<string>>();
	});

	it("should narrow primaryEnvironmentNotFound to expose requested and available", () => {
		expectTypeOf<
			Extract<MigrateError, { kind: "primaryEnvironmentNotFound" }>["requested"]
		>().toEqualTypeOf<string>();
		expectTypeOf<
			Extract<MigrateError, { kind: "primaryEnvironmentNotFound" }>["available"]
		>().toEqualTypeOf<ReadonlyArray<string>>();
	});
});

describe("MigrateError - internalError variant", () => {
	it("should narrow internalError to expose the wrapped ConfigError cause and a reason", () => {
		expectTypeOf<
			Extract<MigrateError, { kind: "internalError" }>["cause"]
		>().toEqualTypeOf<ConfigError>();
		expectTypeOf<
			Extract<MigrateError, { kind: "internalError" }>["reason"]
		>().toEqualTypeOf<string>();
	});
});
