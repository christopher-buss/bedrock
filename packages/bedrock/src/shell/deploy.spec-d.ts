import { describe, expectTypeOf, it } from "vitest";

import type { RebuildHook } from "../core/rebuild.ts";
import type { StateConfig } from "../core/schema.ts";
import type { ResourceKey } from "../types/ids.ts";
import type { DeployError, DeployOptions } from "./deploy.ts";

describe("DeployOptions", () => {
	it("should make every field optional except environment", () => {
		expectTypeOf<{ environment: string }>().toExtend<DeployOptions>();
	});

	it("should type environment as string", () => {
		expectTypeOf<DeployOptions["environment"]>().toEqualTypeOf<string>();
	});

	it("should accept an optional rebuild hook", () => {
		expectTypeOf<DeployOptions["rebuild"]>().toEqualTypeOf<RebuildHook | undefined>();
	});

	it("should accept an optional clearPendingRebuild escape hatch", () => {
		expectTypeOf<DeployOptions["clearPendingRebuild"]>().toEqualTypeOf<boolean | undefined>();
	});
});

describe("DeployError - default-construction variants", () => {
	it("should narrow stateNotConfigured to expose the environment that failed", () => {
		expectTypeOf<
			Extract<DeployError, { kind: "stateNotConfigured" }>["environment"]
		>().toEqualTypeOf<string>();
	});

	it("should narrow missingCredential to expose variable and purpose", () => {
		expectTypeOf<
			Extract<DeployError, { kind: "missingCredential" }>["variable"]
		>().toEqualTypeOf<string>();
		expectTypeOf<
			Extract<DeployError, { kind: "missingCredential" }>["purpose"]
		>().toEqualTypeOf<"registry" | "stateBackend">();
	});

	it("should narrow unsupportedBackend to expose the backend and a hint", () => {
		expectTypeOf<
			Extract<DeployError, { kind: "unsupportedBackend" }>["backend"]
		>().toEqualTypeOf<string>();
		expectTypeOf<
			Extract<DeployError, { kind: "unsupportedBackend" }>["hint"]
		>().toEqualTypeOf<string>();
	});
});

describe("DeployError - registry and config variants", () => {
	it("should narrow registryConfigMissing to expose the missing field", () => {
		expectTypeOf<
			Extract<DeployError, { kind: "registryConfigMissing" }>["missing"]
		>().toEqualTypeOf<"universeId">();
	});

	it("should narrow configLoadFailed to expose the wrapped ConfigError cause", () => {
		expectTypeOf<
			Extract<DeployError, { kind: "configLoadFailed" }>["cause"]["kind"]
		>().toEqualTypeOf<
			| "configFunctionFailed"
			| "fileNotFound"
			| "luauRuntimeMissing"
			| "parseFailed"
			| "validationFailed"
		>();
	});
});

describe("DeployError - two-phase failure variants", () => {
	it("should narrow rebuildHookThrew to expose the stringified reason", () => {
		expectTypeOf<
			Extract<DeployError, { kind: "rebuildHookThrew" }>["reason"]
		>().toEqualTypeOf<string>();
	});

	it("should narrow pendingRebuildWithoutHook to expose the owed place keys", () => {
		expectTypeOf<
			Extract<DeployError, { kind: "pendingRebuildWithoutHook" }>["keys"]
		>().toEqualTypeOf<ReadonlyArray<ResourceKey>>();
	});
});

describe("StateConfig", () => {
	it("should accept the gist literal as a valid backend value", () => {
		expectTypeOf<"gist">().toExtend<StateConfig["backend"]>();
	});

	it("should accept arbitrary strings as a valid backend value via the autocomplete idiom", () => {
		expectTypeOf<string>().toExtend<StateConfig["backend"]>();
	});
});
