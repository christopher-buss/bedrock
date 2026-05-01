import { ApiError, PermissionError } from "@bedrock/ocale";
import { S_BAR, S_BAR_END, S_BAR_START, S_ERROR, S_SUCCESS } from "@clack/prompts";

import { fakeClackPort } from "#tests/helpers/clack";
import { Buffer } from "node:buffer";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";

import type { MigrateError } from "../core/migrate/migration-report.ts";
import type { MissingCredentialError, UnsupportedBackendError } from "../shell/build-state-port.ts";
import type { DeployError } from "../shell/deploy.ts";
import { asResourceKey } from "../types/ids.ts";
import type { ParseMigrateError } from "./parse-migrate-options.ts";
import type { ParseOptionsError } from "./parse-options.ts";
import {
	type ClackPort,
	createClackPort,
	renderBuildStatePortError,
	renderDeployError,
	renderMigrateError,
	renderMigrateParseError,
	renderMigrationSummary,
	renderParseError,
	renderStateWriteError,
} from "./render.ts";

interface CapturedOutput {
	readonly text: string;
}

function captureWith(act: (port: ClackPort) => void): CapturedOutput {
	const chunks: Array<string> = [];
	const spy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: string | Uint8Array): boolean => {
			chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			return true;
		});

	try {
		act(createClackPort());
	} finally {
		spy.mockRestore();
	}

	return { text: chunks.join("") };
}

describe(createClackPort, () => {
	it("should open a frame with the intro corner symbol", () => {
		expect.assertions(3);

		const { text } = captureWith((port) => {
			port.intro("intro-title");
		});

		expect(text).toContain("intro-title");
		expect(text).toContain(S_BAR_START);
		expect(text).not.toContain(S_BAR_END);
	});

	it("should close a frame with the outro corner symbol after a bar continuation", () => {
		expect.assertions(4);

		const { text } = captureWith((port) => {
			port.outro("outro-message");
		});

		expect(text).toContain("outro-message");
		expect(text).toContain(S_BAR_END);
		expect(text).toContain(S_BAR);
		expect(text).not.toContain(S_BAR_START);
	});

	it("should render a cancel without an active bar continuation", () => {
		expect.assertions(4);

		const { text } = captureWith((port) => {
			port.cancel("cancel-message");
		});

		expect(text).toContain("cancel-message");
		expect(text).toContain(S_BAR_END);
		expect(text).not.toContain(S_BAR);
		expect(text).not.toContain(S_BAR_START);
	});

	it("should render a success line with the success symbol", () => {
		expect.assertions(3);

		const { text } = captureWith((port) => {
			port.logSuccess("success-message");
		});

		expect(text).toContain("success-message");
		expect(text).toContain(S_SUCCESS);
		expect(text).not.toContain(S_ERROR);
	});

	it("should render an error line with the error symbol", () => {
		expect.assertions(3);

		const { text } = captureWith((port) => {
			port.logError("error-message");
		});

		expect(text).toContain("error-message");
		expect(text).toContain(S_ERROR);
		expect(text).not.toContain(S_SUCCESS);
	});

	it("should render a plain message line without success, error, or frame symbols", () => {
		expect.assertions(5);

		const { text } = captureWith((port) => {
			port.logMessage("plain-message");
		});

		expect(text).toContain("plain-message");
		expect(text).toContain(S_BAR);
		expect(text).not.toContain(S_SUCCESS);
		expect(text).not.toContain(S_ERROR);
		expect(text).not.toContain(S_BAR_END);
	});
});

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
					key: asResourceKey("vip-pass"),
					appliedSoFar: [],
					kind: "updateUnsupported",
				},
				kind: "applyFailed",
			},
			expected: "apply failed for 'vip-pass': update not supported",
		},
		{
			err: {
				cause: {
					key: asResourceKey("main-place"),
					appliedSoFar: [],
					cause: new ApiError("auth failed (401)", { statusCode: 401 }),
					kind: "driverFailure",
				},
				kind: "applyFailed",
			},
			expected: "apply failed for 'main-place': auth failed (401)",
		},
		{
			err: {
				cause: {
					key: asResourceKey("gem-pack"),
					appliedSoFar: [],
					cause: new PermissionError("HTTP 403", {
						operationKey: "developer-products.create",
						requiredScopes: ["developer-product:write"],
						statusCode: 403,
					}),
					kind: "driverFailure",
				},
				kind: "applyFailed",
			},
			expected:
				"apply failed for 'gem-pack': HTTP 403 on developer-products.create: missing required scope 'developer-product:write'. Grant it on the API key at https://create.roblox.com/credentials",
		},
		{
			err: {
				cause: {
					key: asResourceKey("main-place"),
					appliedSoFar: [],
					cause: new PermissionError("HTTP 401", {
						operationKey: "places.publishVersion",
						requiredScopes: ["universe-places:write", "universe.place:write"],
						statusCode: 401,
					}),
					kind: "driverFailure",
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
				key: "main-place",
				environment: "production",
				kind: "incompletePlaceEntry",
				missingField: "placeId",
			},
			expected: "place 'main-place' is missing 'placeId' under environment 'production'",
		},
	])("should render $err.kind via logError with a kind-specific message", ({ err, expected }) => {
		expect.assertions(1);

		const port = fakeClackPort();

		renderDeployError(err, port);

		expect(port.logError).toHaveBeenCalledExactlyOnceWith(expected);
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
