import { ApiError, PermissionError } from "@bedrock-rbx/ocale";

import { fakeClackPort } from "#tests/helpers/clack";
import { describe, expect, it } from "vitest";

import type { MigrateError } from "../core/migrate/migration-report.ts";
import type { MissingCredentialError, UnsupportedBackendError } from "../shell/build-state-port.ts";
import type { DeployError } from "../shell/deploy.ts";
import { asResourceKey } from "../types/ids.ts";
import type { ParseMigrateError } from "./parse-migrate-options.ts";
import type { ParseOptionsError } from "./parse-options.ts";
import {
	renderBuildStatePortError,
	renderDeployError,
	renderMigrateError,
	renderMigrateParseError,
	renderMigrationSummary,
	renderParseError,
	renderStateWriteError,
} from "./render.ts";

describe(renderDeployError, () => {
	it.for<{ err: DeployError; expected: string }>([
		{
			err: {
				declared: ["production", "staging"],
				environment: "foo",
				kind: "unknownEnvironment",
			},
			expected: "unknown environment 'foo' (declared: production, staging)",
		},
		{
			err: { environment: "production", kind: "stateNotConfigured" },
			expected: "state not configured for environment 'production'",
		},
		{
			err: {
				kind: "missingCredential",
				purpose: "stateBackend",
				variable: "GITHUB_TOKEN",
			},
			expected: "missing credential: environment variable GITHUB_TOKEN is not set",
		},
		{
			err: {
				backend: "s3",
				hint: "pass a custom statePort via opts.statePort",
				kind: "unsupportedBackend",
			},
			expected: "unsupported state backend 's3' (pass a custom statePort via opts.statePort)",
		},
		{
			err: {
				hint: "set universe.universeId in your bedrock config",
				kind: "registryConfigMissing",
				missing: "universeId",
			},
			expected:
				"registry config missing 'universeId' (set universe.universeId in your bedrock config)",
		},
		{
			err: {
				cause: { kind: "fileNotFound", searchedFrom: "/projects/example" },
				kind: "configLoadFailed",
			},
			expected: "config load failed: no bedrock config under /projects/example",
		},
		{
			err: {
				cause: {
					key: asResourceKey("main-place"),
					filePath: "/projects/example/place.rbxl",
					kind: "fileReadFailed",
					reason: "ENOENT",
				},
				kind: "buildDesiredFailed",
			},
			expected:
				"build desired state failed for 'main-place' (/projects/example/place.rbxl): ENOENT",
		},
		{
			err: {
				cause: {
					key: asResourceKey("gem-pack"),
					kind: "iconRemovalRejected",
					message:
						"developer product 'gem-pack' had an icon recorded in state, but the desired entry no longer declares one.",
				},
				kind: "buildDesiredFailed",
			},
			expected:
				"build desired state failed for 'gem-pack': developer product 'gem-pack' had an icon recorded in state, but the desired entry no longer declares one.",
		},
		{
			err: {
				cause: {
					keys: [asResourceKey("bp-1"), asResourceKey("bp-2")] as const,
					kind: "redactedNameCollision",
					message:
						"developer products 'bp-1' and 'bp-2' both resolve to the wire name 'Hidden'.",
					resolvedName: "Hidden",
				},
				kind: "buildDesiredFailed",
			},
			expected:
				"build desired state failed for 'bp-1' and 'bp-2': developer products 'bp-1' and 'bp-2' both resolve to the wire name 'Hidden'.",
		},
		{
			err: {
				cause: { file: "state.json", kind: "stateError", reason: "invalid json" },
				kind: "stateReadFailed",
			},
			expected: "state read failed (state.json): invalid json",
		},
		{
			err: {
				cause: { file: "state.json", kind: "stateError", reason: "network error" },
				kind: "stateWriteFailed",
				unsavedState: { environment: "production", resources: [], version: 1 },
			},
			expected: "state write failed (state.json): network error",
		},
		{
			err: {
				cause: {
					applied: [],
					failures: [
						{
							key: asResourceKey("vip-pass"),
							kind: "updateUnsupported",
						},
					],
				},
				kind: "applyFailed",
			},
			expected: "apply failed for 'vip-pass': update not supported",
		},
		{
			err: {
				cause: {
					applied: [],
					failures: [
						{
							key: asResourceKey("vip-pass"),
							cause: new Error("driver crashed"),
							kind: "unexpectedThrow",
						},
					],
				},
				kind: "applyFailed",
			},
			expected: "apply failed for 'vip-pass': unexpected error: driver crashed",
		},
		{
			err: {
				cause: {
					applied: [],
					failures: [
						{
							key: asResourceKey("vip-pass"),
							cause: "string error",
							kind: "unexpectedThrow",
						},
					],
				},
				kind: "applyFailed",
			},
			expected: "apply failed for 'vip-pass': unexpected error: string error",
		},
		{
			err: {
				cause: {
					applied: [],
					failures: [
						{
							key: asResourceKey("vip-pass"),
							cause: {
								toString() {
									throw new Error("toString rejected coercion");
								},
							},
							kind: "unexpectedThrow",
						},
					],
				},
				kind: "applyFailed",
			},
			expected: "apply failed for 'vip-pass': unexpected error: <unprintable cause>",
		},
		{
			err: {
				cause: {
					applied: [],
					failures: [
						{
							key: asResourceKey("main-place"),
							cause: new ApiError("auth failed (401)", { statusCode: 401 }),
							kind: "driverFailure",
						},
					],
				},
				kind: "applyFailed",
			},
			expected: "apply failed for 'main-place': auth failed (401)",
		},
		{
			err: {
				cause: {
					applied: [],
					failures: [
						{
							key: asResourceKey("gem-pack"),
							cause: new PermissionError("HTTP 403", {
								operationKey: "developer-products.create",
								requiredScopes: ["developer-product:write"],
								statusCode: 403,
							}),
							kind: "driverFailure",
						},
					],
				},
				kind: "applyFailed",
			},
			expected:
				"apply failed for 'gem-pack': HTTP 403 on developer-products.create: missing required scope 'developer-product:write'. Grant it on the API key at https://create.roblox.com/credentials",
		},
		{
			err: {
				cause: {
					applied: [],
					failures: [
						{
							key: asResourceKey("main-place"),
							cause: new PermissionError("HTTP 401", {
								operationKey: "places.publishVersion",
								requiredScopes: ["universe-places:write", "universe.place:write"],
								statusCode: 401,
							}),
							kind: "driverFailure",
						},
					],
				},
				kind: "applyFailed",
			},
			expected:
				"apply failed for 'main-place': HTTP 401 on places.publishVersion: missing required scopes 'universe-places:write', 'universe.place:write'. Grant them on the API key at https://create.roblox.com/credentials",
		},
		{
			err: {
				cause: {
					kind: "parseFailed",
					message: "unexpected end of the stream",
					sourceFile: "bedrock.config.yaml",
				},
				kind: "configLoadFailed",
			},
			expected: "config load failed: bedrock.config.yaml: unexpected end of the stream",
		},
		{
			err: {
				cause: {
					issues: [{ message: "must be a number", path: ["passes", "vip", "price"] }],
					kind: "validationFailed",
					sourceFile: "bedrock.config.ts",
				},
				kind: "configLoadFailed",
			},
			expected: "config load failed: bedrock.config.ts: passes.vip.price must be a number",
		},
		{
			err: {
				cause: {
					issues: [],
					kind: "validationFailed",
					sourceFile: "bedrock.config.ts",
				},
				kind: "configLoadFailed",
			},
			expected: "config load failed: bedrock.config.ts: invalid",
		},
		{
			err: {
				cause: {
					kind: "configFunctionFailed",
					message: "boom",
					sourceFile: "bedrock.config.ts",
				},
				kind: "configLoadFailed",
			},
			expected: "config load failed: bedrock.config.ts: config function threw: boom",
		},
		{
			err: {
				cause: {
					hint: "install lute via mise",
					kind: "luauRuntimeMissing",
					sourceFile: "bedrock.config.luau",
				},
				kind: "configLoadFailed",
			},
			expected: "config load failed: bedrock.config.luau: install lute via mise",
		},
		{
			err: {
				key: "vip-pass",
				environment: "production",
				kind: "incompletePassEntry",
				missingField: "name",
			},
			expected: "pass 'vip-pass' is missing 'name' under environment 'production'",
		},
		{
			err: {
				key: "main-place",
				environment: "production",
				kind: "incompletePlaceEntry",
				missingField: "placeId",
			},
			expected: "place 'main-place' is missing 'placeId' under environment 'production'",
		},
		{
			err: {
				environment: "production",
				kind: "incompleteUniverseEntry",
				missingField: "universeId",
			},
			expected: "universe is missing 'universeId' under environment 'production'",
		},
	])("should render $err.kind via logError with a kind-specific message", ({ err, expected }) => {
		expect.assertions(1);

		const port = fakeClackPort();

		renderDeployError(err, port);

		expect(port.logError).toHaveBeenCalledExactlyOnceWith(expected);
	});

	it("should emit one logError line per failure in declaration order when applyFailed carries multiple failures", () => {
		expect.assertions(4);

		const port = fakeClackPort();

		renderDeployError(
			{
				cause: {
					applied: [],
					failures: [
						{
							key: asResourceKey("main-universe"),
							cause: new ApiError("auth failed (401)", { statusCode: 401 }),
							kind: "driverFailure",
						},
						{
							key: asResourceKey("vip-pass"),
							kind: "updateUnsupported",
						},
						{
							key: asResourceKey("gem-pack"),
							cause: new Error("driver crashed"),
							kind: "unexpectedThrow",
						},
					],
				},
				kind: "applyFailed",
			},
			port,
		);

		expect(port.logError).toHaveBeenCalledTimes(3);
		expect(port.logError).toHaveBeenNthCalledWith(
			1,
			"apply failed for 'main-universe': auth failed (401)",
		);
		expect(port.logError).toHaveBeenNthCalledWith(
			2,
			"apply failed for 'vip-pass': update not supported",
		);
		expect(port.logError).toHaveBeenNthCalledWith(
			3,
			"apply failed for 'gem-pack': unexpected error: driver crashed",
		);
	});
});

describe(renderParseError, () => {
	it.for<{ err: ParseOptionsError; expected: string }>([
		{
			err: { flag: "env", kind: "missingRequired" },
			expected: "missing required flag --env",
		},
		{
			err: { flag: "verbose", kind: "unknownFlag" },
			expected: "unknown flag '--verbose'",
		},
		{
			err: { flag: "env", kind: "invalidValue" },
			expected: "invalid value for flag '--env' (expected a string)",
		},
	])("should render $err.kind via logError with a flag-specific message", ({ err, expected }) => {
		expect.assertions(1);

		const port = fakeClackPort();

		renderParseError(err, port);

		expect(port.logError).toHaveBeenCalledExactlyOnceWith(expected);
	});
});

describe(renderMigrateParseError, () => {
	it.for<{ err: ParseMigrateError; expected: string }>([
		{
			err: { flag: "from", kind: "missingRequired" },
			expected: "missing required flag --from",
		},
		{
			err: {
				kind: "unknownSource",
				received: "x",
				supported: ["mantle", "universe"],
			},
			expected: "unknown migration source 'x' (supported: mantle, universe)",
		},
	])(
		"should render $err.kind via logError with a migrate-specific message",
		({ err, expected }) => {
			expect.assertions(1);

			const port = fakeClackPort();

			renderMigrateParseError(err, port);

			expect(port.logError).toHaveBeenCalledExactlyOnceWith(expected);
		},
	);
});

describe(renderMigrateError, () => {
	it.for<{ err: MigrateError; expected: string }>([
		{
			err: { kind: "stateFileNotFound", path: "./.mantle-state.yml" },
			expected: "Mantle state file not found at './.mantle-state.yml'",
		},
		{
			err: {
				kind: "stateParseFailed",
				path: "./.mantle-state.yml",
				reason: "unexpected end of stream",
			},
			expected:
				"Mantle state file at './.mantle-state.yml' could not be parsed: unexpected end of stream",
		},
		{
			err: {
				found: "5",
				kind: "unsupportedMantleStateVersion",
				supported: ["6", "7"],
			},
			expected: "unsupported Mantle state version '5' (supported: 6, 7)",
		},
		{
			err: { available: ["production", "staging"], kind: "primaryEnvironmentRequired" },
			expected: "primary environment required (available: production, staging)",
		},
		{
			err: {
				available: ["production", "staging"],
				kind: "primaryEnvironmentNotFound",
				primary: "ghost",
			},
			expected: "primary environment 'ghost' not found (available: production, staging)",
		},
		{
			err: {
				cause: { kind: "fileNotFound", searchedFrom: "/projects/example" },
				kind: "internalError",
				reason: "config validation failed",
			},
			expected:
				"migrate internal error: config validation failed (no bedrock config under /projects/example)",
		},
	])("should render $err.kind via logError with a kind-specific message", ({ err, expected }) => {
		expect.assertions(1);

		const port = fakeClackPort();

		renderMigrateError(err, port);

		expect(port.logError).toHaveBeenCalledExactlyOnceWith(expected);
	});
});

describe(renderBuildStatePortError, () => {
	it.for<{ err: MissingCredentialError | UnsupportedBackendError; expected: string }>([
		{
			err: { kind: "missingCredential", purpose: "stateBackend", variable: "GITHUB_TOKEN" },
			expected: "missing credential: environment variable GITHUB_TOKEN is not set",
		},
		{
			err: { backend: "s3", hint: "pass a custom statePort", kind: "unsupportedBackend" },
			expected: "unsupported state backend 's3' (pass a custom statePort)",
		},
	])("should render $err.kind via logError with a kind-specific message", ({ err, expected }) => {
		expect.assertions(1);

		const port = fakeClackPort();

		renderBuildStatePortError(err, port);

		expect(port.logError).toHaveBeenCalledExactlyOnceWith(expected);
	});
});

describe(renderStateWriteError, () => {
	it("should render the environment, file path, and reason in one logError line", () => {
		expect.assertions(1);

		const port = fakeClackPort();

		renderStateWriteError(
			{
				environment: "production",
				err: {
					file: "gist:abc/state.production.json",
					kind: "stateError",
					reason: "auth 401",
				},
			},
			port,
		);

		expect(port.logError).toHaveBeenCalledExactlyOnceWith(
			"state write failed for 'production' (gist:abc/state.production.json): auth 401",
		);
	});
});

describe(renderMigrationSummary, () => {
	const reportPath = "/projects/example/.bedrock/migration-report.md";

	it("should emit an action-required logError naming the ambiguous count and report path", () => {
		expect.assertions(2);

		const port = fakeClackPort();

		renderMigrationSummary(
			{
				reportPath,
				summary: {
					ambiguousCount: 4,
					blockedCount: 2,
					deferredCount: 1,
					interpretiveCount: 1,
				},
			},
			port,
		);

		expect(port.logError).toHaveBeenCalledExactlyOnceWith(
			`action required: 4 fields need your input. See ${reportPath}`,
		);
		expect(port.logSuccess).not.toHaveBeenCalled();
	});

	it("should emit a review-needed logSuccess when only non-ambiguous warnings exist", () => {
		expect.assertions(2);

		const port = fakeClackPort();

		renderMigrationSummary(
			{
				reportPath,
				summary: {
					ambiguousCount: 0,
					blockedCount: 5,
					deferredCount: 3,
					interpretiveCount: 2,
				},
			},
			port,
		);

		expect(port.logSuccess).toHaveBeenCalledExactlyOnceWith(
			`migration complete; see ${reportPath} for 10 auto-mapped or skipped fields`,
		);
		expect(port.logError).not.toHaveBeenCalled();
	});

	it("should stay silent when every count is zero", () => {
		expect.assertions(3);

		const port = fakeClackPort();

		renderMigrationSummary(
			{
				reportPath,
				summary: {
					ambiguousCount: 0,
					blockedCount: 0,
					deferredCount: 0,
					interpretiveCount: 0,
				},
			},
			port,
		);

		expect(port.logError).not.toHaveBeenCalled();
		expect(port.logSuccess).not.toHaveBeenCalled();
		expect(port.logMessage).not.toHaveBeenCalled();
	});

	it("should suppress the review-needed line when only ambiguous warnings exist", () => {
		expect.assertions(2);

		const port = fakeClackPort();

		renderMigrationSummary(
			{
				reportPath,
				summary: {
					ambiguousCount: 1,
					blockedCount: 0,
					deferredCount: 0,
					interpretiveCount: 0,
				},
			},
			port,
		);

		expect(port.logError).toHaveBeenCalledExactlyOnceWith(
			`action required: 1 fields need your input. See ${reportPath}`,
		);
		expect(port.logSuccess).not.toHaveBeenCalled();
	});
});
