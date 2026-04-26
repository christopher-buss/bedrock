import { S_BAR, S_BAR_END, S_BAR_START, S_ERROR, S_SUCCESS } from "@clack/prompts";

import { Buffer } from "node:buffer";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";

import type { DeployError } from "../shell/deploy.ts";
import { asResourceKey } from "../types/ids.ts";
import type { ParseOptionsError } from "./parse-options.ts";
import { type ClackPort, createClackPort, renderDeployError, renderParseError } from "./render.ts";

interface CapturedOutput {
	readonly text: string;
}

function fakeClackPort(): ClackPort {
	return {
		cancel: vi.fn<ClackPort["cancel"]>(),
		intro: vi.fn<ClackPort["intro"]>(),
		logError: vi.fn<ClackPort["logError"]>(),
		logMessage: vi.fn<ClackPort["logMessage"]>(),
		logSuccess: vi.fn<ClackPort["logSuccess"]>(),
		outro: vi.fn<ClackPort["outro"]>(),
	};
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
			expected: "config load failed (fileNotFound)",
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
			expected: "build desired state failed (fileReadFailed)",
		},
		{
			err: {
				cause: { file: "state.json", kind: "stateError", reason: "invalid json" },
				kind: "stateReadFailed",
			},
			expected: "state read failed (stateError)",
		},
		{
			err: {
				cause: { file: "state.json", kind: "stateError", reason: "network error" },
				kind: "stateWriteFailed",
				unsavedState: { environment: "production", resources: [], version: 1 },
			},
			expected: "state write failed (stateError)",
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
			expected: "apply failed (updateUnsupported)",
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
